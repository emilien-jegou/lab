// Schema definition, database scope, table setup, and dbschema factory.
import { Layer } from 'effect';
import * as Effect from 'effect/Effect';

import { field } from '../api';
import type {
  AnyFieldSpec,
  DocumentDef,
  RawSQL,
  SelectInput,
  SurrealID,
  ToFieldSpec,
} from '../api';
import { SurrealEngine } from '../engine';
import { isSurrealID } from './ast-helpers';
import { CreateBuilder } from './create';
import { DeleteBuilder } from './delete';
import {
  type AnyDocumentDef,
  type AnyExecutableQuery,
  type Doc,
  type ExtractQueryReturn,
} from './executable';
import { InsertBuilder } from './insert';
import { RelateBuilder } from './relate';
import { SelectBuilder } from './select';
import { TransactionBuilder } from './transaction';
import { UpdateBuilder } from './update';
import { UpsertBuilder } from './upsert';

export class DocScope<Docs extends readonly DocumentDef<any, any, any>[], T> {
  private readonly docDef?: AnyDocumentDef;

  constructor(
    private readonly target: T,
    private readonly db: DatabaseSchema<Docs>,
  ) {
    const tableName =
      typeof target === 'string'
        ? target.includes(':')
          ? target.slice(0, target.indexOf(':'))
          : target
        : isSurrealID(target)
          ? target.table
          : undefined;
    if (tableName && this.db.docs[tableName]) {
      this.docDef = this.db.docs[tableName];
    }
  }

  select(): SelectBuilder<Docs, T, []>;
  select<F extends readonly SelectInput<Doc<Docs, T>>[]>(
    ...fields: F
  ): SelectBuilder<Docs, T, { [K in keyof F]: ToFieldSpec<F[K]> }>;
  select(...fields: any[]) {
    return new SelectBuilder<Docs, T, any>(
      this.db.engine,
      this.target,
      {
        fields: fields.map((f) => (typeof f === 'string' ? field(f) : (f as AnyFieldSpec))),
        only: false,
        omit: [],
        withIndex: [],
        splitAt: [],
        groupBy: [],
        groupAll: false,
        orderBy: [],
        fetch: [],
      },
      this.docDef,
    );
  }

  create(data: Doc<Docs, T> | readonly Doc<Docs, T>[]) {
    return new CreateBuilder<Docs, T>(this.db.engine, this.target, data, { only: false }, this.docDef);
  }

  insert(data: Doc<Docs, T> | readonly Doc<Docs, T>[]) {
    return new InsertBuilder<Docs, T>(this.db.engine, this.target, data, {}, this.docDef);
  }

  update() {
    return new UpdateBuilder<Docs, T>(this.db.engine, this.target, { only: false }, this.docDef);
  }

  upsert() {
    return new UpsertBuilder<Docs, T>(this.db.engine, this.target, { only: false }, this.docDef);
  }

  remove() {
    return new DeleteBuilder<Docs, T, false, 'NONE'>(this.db.engine, this.target, { only: false }, this.docDef);
  }

  relate(edge: string) {
    return new RelateBuilder<Docs, T>(this.db.engine, this.target, edge);
  }
}

export class DatabaseSchema<Docs extends readonly DocumentDef<any, any, any>[]> {
  public docs: Record<string, AnyDocumentDef> = {};

  constructor(
    public engine: SurrealEngine,
    docsList: Docs,
  ) {
    for (const doc of docsList) {
      this.docs[doc.name] = doc as AnyDocumentDef;
    }
  }

  doc<T extends Docs[number]['name'] | `${Docs[number]['name']}:${string}` | SurrealID<Docs[number]['name']> | RawSQL>(target: T) {
    return new DocScope<Docs, T>(target, this);
  }

  transaction(): TransactionBuilder<Docs, []>;
  transaction<Ops extends readonly AnyExecutableQuery[]>(
    fn: (tx: DatabaseSchema<Docs>) => Ops,
  ): TransactionBuilder<Docs, { [K in keyof Ops]: ExtractQueryReturn<Ops[K]> }>;
  transaction<Ops extends readonly AnyExecutableQuery[]>(
    operations: Ops,
  ): TransactionBuilder<Docs, { [K in keyof Ops]: ExtractQueryReturn<Ops[K]> }>;
  transaction<Ops extends readonly AnyExecutableQuery[]>(
    ...operations: Ops
  ): TransactionBuilder<Docs, { [K in keyof Ops]: ExtractQueryReturn<Ops[K]> }>;
  transaction(...args: any[]): any {
    if (args.length === 0) {
      return new TransactionBuilder<Docs, []>(this.engine, this, []);
    }
    if (typeof args[0] === 'function') {
      const ops = args[0](this);
      return new TransactionBuilder(this.engine, this, ops);
    }
    if (Array.isArray(args[0])) {
      return new TransactionBuilder(this.engine, this, args[0]);
    }
    return new TransactionBuilder(this.engine, this, args);
  }
}

export class SchemaDefinition<Docs extends readonly DocumentDef<any, any, any>[]> {
  constructor(public docs: Docs) { }

  connect(engine: SurrealEngine): DatabaseSchema<Docs> {
    return new DatabaseSchema<Docs>(engine, this.docs);
  }

  asEffect(): Effect.Effect<DatabaseSchema<Docs>, never, SurrealEngine> {
    const docs = this.docs;
    return Effect.gen(function*() {
      const engine = yield* SurrealEngine;
      for (const doc of docs) {
        yield* defineTable(engine, doc.name);
      }
      return new DatabaseSchema<Docs>(engine, docs);
    });
  }

  [Symbol.iterator]() {
    return this.asEffect()[Symbol.iterator]();
  }

  get Live(): this {
    return this;
  }
}

// ============================================================================
// TABLE SETUP & DBSCHEMA FACTORY
// ============================================================================

export type DbSchema<Docs extends readonly DocumentDef<any, any, any>[]> =
  Layer.Layer<never, never, SurrealEngine> &
  Effect.Effect<DatabaseSchema<Docs>, never, SurrealEngine> & {
    readonly docs: Docs;
    readonly Live: Layer.Layer<never, never, SurrealEngine>;
    readonly connect: (engine: SurrealEngine) => DatabaseSchema<Docs>;
    readonly asEffect: () => Effect.Effect<DatabaseSchema<Docs>, never, SurrealEngine>;
  };

const defineTable = (engine: SurrealEngine, tableName: string) =>
  engine
    .query<unknown>(`DEFINE TABLE IF NOT EXISTS \`${tableName}\` SCHEMALESS;`, {})
    .pipe(
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[SurrealDB] Failed to auto-define table "${tableName}": ${err.message}`,
          ),
        ),
      ),
    );

export function dbschema<Docs extends readonly DocumentDef<any, any, any>[]>(
  ...docs: Docs
): DbSchema<Docs>;
export function dbschema<Docs extends readonly DocumentDef<any, any, any>[]>(
  name: string,
  ...docs: Docs
): DbSchema<Docs>;
export function dbschema(...args: any[]): any {
  const [nameOrDoc, ...rest] = args;
  const hasCustomName = typeof nameOrDoc === 'string';
  const docs = (hasCustomName ? rest : args) as readonly AnyDocumentDef[];

  const asEffect = () =>
    Effect.gen(function*() {
      const engine = yield* SurrealEngine;
      return new DatabaseSchema(engine, docs);
    });

  const realLayer = Layer.effectDiscard(
    Effect.gen(function*() {
      const engine = yield* SurrealEngine;
      for (const doc of docs) {
        yield* defineTable(engine, doc.name);
      }
    }),
  );

  const helpers = {
    docs,
    Live: realLayer,
    connect: (engine: SurrealEngine) => new DatabaseSchema(engine, docs),
    asEffect,
  };

  const effectInstance = asEffect();

  const proxy = new Proxy(effectInstance, {
    get(target, prop, receiver) {
      if (prop === 'Live') {
        return realLayer;
      }
      if (prop in helpers) {
        const val = (helpers as any)[prop];
        return typeof val === 'function' ? val.bind(helpers) : val;
      }
      // Delegate Layer identity to realLayer
      if (prop === (Layer as any).LayerTypeId) {
        return (realLayer as any)[prop];
      }
      if (prop in realLayer && !(prop in target)) {
        const val = (realLayer as any)[prop];
        return typeof val === 'function' ? val.bind(realLayer) : val;
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
    has(target, prop) {
      return (
        prop === 'Live' ||
        prop in helpers ||
        prop === (Layer as any).LayerTypeId ||
        Reflect.has(realLayer, prop) ||
        Reflect.has(target, prop)
      );
    },
  });

  return proxy as any;
}
