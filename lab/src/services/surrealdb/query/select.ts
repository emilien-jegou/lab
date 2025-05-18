// Fluent immutable SELECT query builder and its state.
import { Either, Schema } from 'effect';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';

import type {
  AnyFieldSpec,
  DocumentDef,
  FieldName,
  IsAny,
  LiveNotification,
  OrderClause,
  ProjectFields,
  SchemaDB,
  WhereClause,
  WrapOnly,
} from '../api';
import type { SelectStatement } from '../ast';
import { Ast } from '../ast-builder';
import type { SurrealError } from '../engine';
import {
  normalizeValue,
  SurrealDecodeError,
  SurrealEngine,
  SurrealQueryError,
  SurrealRecordNotFoundError,
} from '../engine';
import { StatementBuilder } from '../statement-builder';
import { mapFieldSpec, parseTarget, parseWhere } from './ast-helpers';
import { type AnyDocumentDef, type Doc, ExecutableQuery } from './executable';

interface SelectState<TDoc> {
  readonly fields: readonly AnyFieldSpec[];
  readonly only: boolean;
  readonly live?: boolean;
  readonly diff?: boolean;
  readonly where?: WhereClause<TDoc>;
  readonly omit: readonly string[];
  readonly withIndex: readonly string[];
  readonly splitAt: readonly string[];
  readonly groupBy: readonly string[];
  readonly groupAll: boolean;
  readonly orderBy: readonly OrderClause<TDoc>[];
  readonly fetch: readonly string[];
  readonly limit?: number;
  readonly start?: number;
  readonly timeout?: string;
  readonly explain?: boolean | 'FULL';
}

export class SelectBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  T,
  Specs extends readonly AnyFieldSpec[],
  Only extends boolean = false,
> extends ExecutableQuery<
  WrapOnly<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>, Only>,
  SurrealError
> {
  constructor(
    engine: SurrealEngine,
    private readonly target: T,
    private readonly state: SelectState<Doc<Docs, T>>,
    private readonly docDef?: AnyDocumentDef,
  ) {
    super(engine);
  }

  private clone<NewOnly extends boolean = Only, NewSpecs extends readonly AnyFieldSpec[] = Specs>(
    patch: Partial<SelectState<Doc<Docs, T>>>,
  ): SelectBuilder<Docs, T, NewSpecs, NewOnly> {
    return new SelectBuilder<Docs, T, NewSpecs, NewOnly>(
      this.engine,
      this.target,
      { ...this.state, ...patch },
      this.docDef,
    );
  }

  first(): SelectBuilder<Docs, T, Specs, true> {
    return this.clone<true, Specs>({ only: true });
  }

  where(w: WhereClause<Doc<Docs, T>>): SelectBuilder<Docs, T, Specs, Only> {
    const currentWhere = this.state.where;
    const combinedWhere: WhereClause<Doc<Docs, T>> = currentWhere
      ? { $and: [currentWhere, w] }
      : w;
    return this.clone({ where: combinedWhere });
  }

  omit(...fields: FieldName<Doc<Docs, T>>[]): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ omit: [...this.state.omit, ...(fields as string[])] });
  }

  withIndex(...indexes: string[]): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ withIndex: [...this.state.withIndex, ...indexes] });
  }

  splitAt(...fields: FieldName<Doc<Docs, T>>[]): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ splitAt: [...this.state.splitAt, ...(fields as string[])] });
  }

  groupBy(...fields: FieldName<Doc<Docs, T>>[]): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ groupBy: [...this.state.groupBy, ...(fields as string[])] });
  }

  groupAll(): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ groupAll: true });
  }

  orderBy(...clauses: OrderClause<Doc<Docs, T>>[]): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ orderBy: [...this.state.orderBy, ...clauses] });
  }

  fetch(...fields: (IsAny<Doc<Docs, T>> extends true ? string : (keyof Doc<Docs, T> & string))[]): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ fetch: [...this.state.fetch, ...(fields as string[])] });
  }

  limit(n: number): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ limit: n });
  }

  start(n: number): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ start: n });
  }

  timeout(duration: string): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ timeout: duration });
  }

  explain(mode: boolean | 'FULL' = true): SelectBuilder<Docs, T, Specs, Only> {
    return this.clone({ explain: mode });
  }

  getAst(): SelectStatement {
    const builder = Ast.stmt.select().from([parseTarget(this.target)]);
    if (this.state.live) builder.live(true);
    if (this.state.diff) builder.diff(true);
    if (this.state.only) builder.only(true);
    if (this.state.where) {
      const w = parseWhere(this.state.where);
      if (w) builder.where(w);
    }
    if (this.state.fields.length) builder.fields(this.state.fields.map(mapFieldSpec));
    if (this.state.omit.length) builder.omit(this.state.omit);
    if (this.state.withIndex.length) builder.withIndex(this.state.withIndex);
    if (this.state.splitAt.length) builder.splitAt(this.state.splitAt);
    if (this.state.groupBy.length) builder.groupBy(this.state.groupBy);
    if (this.state.groupAll) builder.groupBy(['ALL']);
    if (this.state.orderBy.length)
      builder.orderBy(
        this.state.orderBy.map((o) => ({
          field: Ast.val.ident(o.field as string),
          direction: o.direction ?? 'ASC',
          collate: o.collate ?? false,
          numeric: o.numeric ?? false,
        })),
      );
    if (this.state.fetch.length) builder.fetch(this.state.fetch);
    if (this.state.limit !== undefined) builder.limit(this.state.limit);
    if (this.state.start !== undefined) builder.start(this.state.start);
    if (this.state.timeout !== undefined) builder.timeout(this.state.timeout);
    if (this.state.explain !== undefined) builder.explain(this.state.explain);

    return builder.build();
  }

  live(options?: { diff?: boolean }): Stream.Stream<
    LiveNotification<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>>,
    SurrealError
  > & { getAst(): SelectStatement } {
    const liveBuilder = this.clone({ live: true, diff: options?.diff });
    return liveBuilder.toStream();
  }

  toStream(): Stream.Stream<
    LiveNotification<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>>,
    SurrealError
  > & { getAst(): SelectStatement } {
    const self = this;
    const stream = Stream.asyncScoped<
      LiveNotification<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>>,
      SurrealError
    >((emit) =>
      Effect.gen(function*() {
        const statement = self.getAst();
        const { sql, bindings } = new StatementBuilder().compile(statement);

        if (!self.engine.live) {
          return yield* Effect.fail(
            new SurrealQueryError({
              sql,
              bindings,
              cause: new Error('Live queries are not supported by the configured engine.'),
              message: 'The current SurrealEngine does not support live queries.',
            }),
          );
        }

        const unsubscribe = yield* self.engine.live<unknown>(
          sql,
          bindings,
          (rawNotification) => {
            const normalizedResult = normalizeValue(rawNotification.result);

            if (!self.docDef?.schema || self.state.fields.length > 0 || self.state.diff) {
              emit.single({
                ...rawNotification,
                result: normalizedResult,
              } as LiveNotification<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>>);
              return;
            }

            const schema = self.docDef.schema;
            const decoded = Schema.decodeUnknownEither(schema)(normalizedResult);

            if (Either.isRight(decoded)) {
              emit.single({
                ...rawNotification,
                result: decoded.right as ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>,
              });
            } else {
              emit.fail(
                new SurrealDecodeError({
                  issue: decoded.left,
                  message: `Failed to decode live notification against schema "${self.docDef?.name}": ${decoded.left}`,
                }),
              );
            }
          },
        );

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await unsubscribe();
          }),
        );
      }),
    );

    return Object.assign(stream, {
      getAst: () => self.getAst(),
    });
  }

  override decodeResult(
    rawResult: unknown,
  ): Effect.Effect<
    WrapOnly<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>, Only>,
    SurrealError,
    never
  > {
    const normalized = normalizeValue(rawResult);
    const isSingle = this.state.only;
    const actualResult = this.state.only
      ? Array.isArray(normalized)
        ? (normalized[0] ?? null)
        : normalized
      : Array.isArray(normalized)
        ? normalized
        : normalized === null || normalized === undefined
          ? []
          : [normalized];

    if (this.state.only && (actualResult === null || actualResult === undefined)) {
      return Effect.fail(
        new SurrealRecordNotFoundError({
          target: this.target,
          message: `Record not found for query target: ${JSON.stringify(this.target)}`,
        }),
      );
    }
    if (!this.docDef?.schema || this.state.fields.length > 0) {
      return Effect.succeed(
        actualResult as WrapOnly<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>, Only>,
      );
    }

    const s: Schema.Schema<any, any, never> = this.docDef.schema;
    const targetSchema: Schema.Schema<any, any, never> = isSingle
      ? s
      : (Schema.Array(s) as Schema.Schema<any, any, never>);

    return Schema.decodeUnknown(targetSchema)(actualResult).pipe(
      Effect.mapError(
        (issue) =>
          new SurrealDecodeError({
            issue,
            message: `Failed to decode query result against document schema "${this.docDef?.name}": ${issue}`,
          }),
      ),
      Effect.map(
        (res) => res as WrapOnly<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>, Only>,
      ),
    );
  }

  toEffect(): Effect.Effect<
    WrapOnly<ProjectFields<Doc<Docs, T>, Specs, SchemaDB<Docs>>, Only>,
    SurrealError,
    never
  > {
    return Effect.suspend(() => {
      const statement = this.getAst();
      return this.executeAst(statement).pipe(
        Effect.flatMap((rawResult) => this.decodeResult(rawResult)),
      );
    });
  }
}
