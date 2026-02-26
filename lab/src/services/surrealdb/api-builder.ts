import { Either, Layer, Schema } from 'effect';
import * as Effect from 'effect/Effect';
import { pipeArguments } from 'effect/Pipeable';
import * as Stream from 'effect/Stream';

import type {
  AnyFieldSpec,
  DeepPartial,
  DocumentDef,
  ExtractDocType,
  FieldName,
  IsAny,
  LiveAction,
  LiveNotification,
  OdmCondition,
  OdmValue,
  OrderClause,
  ProjectFields,
  RawSQL,
  ResolveDeleteReturn,
  ResolveUpdateReturn,
  ReturnKeyword,
  SchemaDB,
  SelectInput,
  SurrealID,
  ToFieldSpec,
  UpdateMode,
  WhereClause,
  WrapOnly,
} from './api';
import { field } from './api';
export { as_, document, field, rel, relPath } from './api';
export type { LiveAction, LiveNotification };

import type {
  AstCondition,
  AstValue,
  CreateStatement,
  DataClause,
  DeleteStatement,
  InsertStatement,
  RelateStatement,
  SelectStatement,
  StatementNode,
  SurrealOperator,
  TransactionStatement,
  UpdateStatement,
  UpsertStatement,
} from './ast';
import { Ast } from './ast-builder';
import type { SurrealConnectionError, SurrealError } from './engine';
import {
  normalizeValue,
  SurrealDecodeError,
  SurrealEngine,
  SurrealQueryError,
  SurrealRecordNotFoundError,
  unwrapSurrealResult,
  unwrapSurrealTransactionResults,
} from './engine';

export type { SurrealError };
export {
  SurrealConnectionError,
  SurrealDecodeError,
  SurrealQueryError,
  SurrealRecordNotFoundError,
} from './engine';

import { StatementBuilder } from './statement-builder';

// ============================================================================
// INTERNAL HELPERS & DOCUMENT DEFINITIONS
// ============================================================================

export type AnyDocumentDef = DocumentDef<
  string,
  Schema.Schema<any, any, never>,
  readonly any[]
>;

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
function isSurrealID(val: unknown): val is SurrealID {
  return isObject(val) && (val as any)._tag === 'SurrealID';
}
function isRawSQL(val: unknown): val is RawSQL {
  return isObject(val) && (val as any)._tag === 'RawSQL';
}
function isOdmValue(val: unknown): val is OdmValue {
  return isObject(val) && (val as any)._tag === 'OdmValue';
}
function isOdmCondition(val: unknown): val is OdmCondition {
  return isObject(val) && (val as any)._tag === 'OdmCondition';
}
function isOperatorObject(val: unknown): val is Record<string, unknown> {
  return (
    isObject(val) &&
    !(val instanceof Date) &&
    !('_tag' in val) &&
    Object.keys(val).some((k) => k.startsWith('$'))
  );
}

function toAstValue(val: unknown): AstValue {
  if (isSurrealID(val)) return Ast.val.id(val.table, val.value);
  if (isRawSQL(val)) return Ast.val.rawNode(val.strings, val.values);
  if (isOdmValue(val)) return val.ast as AstValue;
  if (val && typeof val === 'object' && '_tag' in val && (val as any)._tag === 'Field') {
    return Ast.val.ident((val as any).name);
  }
  return Ast.val.literal(val);
}

function toAstFieldOrValue(val: unknown): AstValue {
  if (typeof val === 'string') return Ast.val.ident(val);
  if (val && typeof val === 'object' && '_tag' in val && (val as any)._tag === 'Field') {
    return Ast.val.ident((val as any).name);
  }
  return toAstValue(val);
}

function parseTarget(target: unknown): AstValue {
  if (isSurrealID(target)) return Ast.val.id(target.table, target.value);
  if (isRawSQL(target)) return Ast.val.rawNode(target.strings, target.values);
  if (typeof target === 'string') {
    if (target.includes(':')) {
      const colonIndex = target.indexOf(':');
      const table = target.slice(0, colonIndex);
      const idPart = target.slice(colonIndex + 1);
      const cleanId =
        idPart.startsWith('"') && idPart.endsWith('"')
          ? idPart.slice(1, -1)
          : idPart;

      let parsedId: unknown = cleanId;
      if (/^-?\d+$/.test(cleanId)) {
        parsedId = Number(cleanId);
      } else if (
        (cleanId.startsWith('[') && cleanId.endsWith(']')) ||
        (cleanId.startsWith('{') && cleanId.endsWith('}'))
      ) {
        try {
          parsedId = JSON.parse(cleanId);
        } catch {
          // Keep string if malformed JSON
        }
      }

      return Ast.val.id(table, parsedId as string | number | object | readonly unknown[]);
    }
    return Ast.val.ident(target);
  }
  throw new Error('Invalid target type');
}

export const compare = (
  left: unknown,
  operator: SurrealOperator,
  right: unknown,
): OdmCondition => ({
  _tag: 'OdmCondition',
  ast: Ast.cond.compare(toAstFieldOrValue(left), operator, toAstValue(right)),
});

function mapFieldSpec(s: any): AstValue {
  if (isOdmValue(s)) return s.ast;
  if (s && typeof s === 'object' && '_tag' in s) {
    if (s._tag === 'Field') return Ast.val.ident(s.name);
    if (s._tag === 'As') {
      const expr = isOdmValue(s.field) ? (s.field.ast as AstValue) : Ast.val.ident(String(s.field));
      return Ast.val.alias(expr, s.alias);
    }
    if (s._tag === 'Rel') return Ast.val.graphPath(s.path);
  }
  if (typeof s === 'string') return Ast.val.ident(s);
  return Ast.val.ident(String(s?.name || s?.path || s?.alias || s));
}

const OP_MAP: Record<string, SurrealOperator> = {
  $eq: '=',
  $not: '!=',
  $exact: '==',
  $fuzzy: '~',
  $notFuzzy: '!~',
  $anyEq: '?=',
  $allEq: '*=',
  $anyFuzzy: '?~',
  $allFuzzy: '*~',
  $lt: '<',
  $lte: '<=',
  $gt: '>',
  $gte: '>=',
  $contains: 'CONTAINS',
  $notContains: 'CONTAINSNOT',
  $containsAll: 'CONTAINSALL',
  $containsAny: 'CONTAINSANY',
  $containsNone: 'CONTAINSNONE',
  $in: 'INSIDE',
  $notIn: 'NOTINSIDE',
  $allIn: 'ALLINSIDE',
  $anyIn: 'ANYINSIDE',
  $noneIn: 'NONEINSIDE',
  $outside: 'OUTSIDE',
  $intersects: 'INTERSECTS',
  $search: '@@',
};

function parseWhere(where?: WhereClause): AstCondition | undefined {
  if (!where) return undefined;
  const conditions: AstCondition[] = [];
  const whereRecord = where as Record<string, unknown>;

  if (Array.isArray(whereRecord.$and)) {
    const ops = (whereRecord.$and as readonly WhereClause[])
      .map(parseWhere)
      .filter((c): c is AstCondition => c !== undefined);
    if (ops.length) conditions.push(Ast.cond.and(...ops));
  }
  if (Array.isArray(whereRecord.$or)) {
    const ops = (whereRecord.$or as readonly WhereClause[])
      .map(parseWhere)
      .filter((c): c is AstCondition => c !== undefined);
    if (ops.length) conditions.push(Ast.cond.or(...ops));
  }
  if (Array.isArray(whereRecord.$nullish)) {
    const [key, val] = whereRecord.$nullish as unknown as readonly [string, unknown];
    conditions.push(Ast.cond.nullish(Ast.val.ident(key), toAstValue(val)));
  }
  if (whereRecord.$raw) {
    const raws = Array.isArray(whereRecord.$raw) ? whereRecord.$raw : [whereRecord.$raw];
    for (const r of raws) {
      if (isRawSQL(r)) conditions.push(Ast.cond.rawNode(r.strings, r.values));
    }
  }
  if (whereRecord.$expr) {
    const exprs = Array.isArray(whereRecord.$expr) ? whereRecord.$expr : [whereRecord.$expr];
    for (const e of exprs) {
      if (isOdmValue(e) || isOdmCondition(e)) {
        conditions.push((e as any).ast);
      }
    }
  }

  for (const [key, val] of Object.entries(whereRecord)) {
    if (['$and', '$or', '$nullish', '$raw', '$expr'].includes(key)) continue;
    if (val === undefined) continue;
    const left = Ast.val.ident(key);
    if (isOperatorObject(val)) {
      for (const [opKey, opVal] of Object.entries(val as Record<string, unknown>)) {
        if (opKey === '$knn' && Array.isArray(opVal)) {
          const [k, metric, target] = opVal;
          if (target !== undefined) {
            conditions.push(
              Ast.cond.compare(
                left,
                '<|',
                Ast.val.rawNode([`${k}, ${metric}|> `, ''], [target]),
              ),
            );
          } else {
            conditions.push(Ast.cond.compare(left, '<|', Ast.val.raw(`${k}, ${metric}|>`)));
          }
          continue;
        }
        const mappedOp = OP_MAP[opKey];
        if (mappedOp) conditions.push(Ast.cond.compare(left, mappedOp, toAstValue(opVal)));
      }
    } else {
      conditions.push(Ast.cond.eq(left, toAstValue(val)));
    }
  }
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return Ast.cond.and(...conditions);
}

function parseDataMode(mode: UpdateMode): DataClause {
  switch (mode.type) {
    case 'SET': {
      if (Array.isArray(mode.data)) {
        throw new Error('SET mode does not support arrays. Use content() or merge() instead.');
      }
      const entries = Object.entries(mode.data as Record<string, unknown>);
      if (entries.length === 0) {
        throw new Error('SET clause requires at least one field assignment');
      }
      const assignments: Record<string, AstValue> = {};
      for (const [k, v] of entries)
        assignments[k] = toAstValue(v);
      return Ast.data.set(assignments);
    }
    case 'UNSET':
      return Ast.data.unset(mode.fields.map(String));
    case 'MERGE':
      return Ast.data.merge(toAstValue(mode.data));
    case 'CONTENT':
      return Ast.data.content(toAstValue(mode.data));
    case 'PATCH':
      return Ast.data.patch(toAstValue(mode.data));
    default:
      throw new Error('Unsupported mode type');
  }
}

// ============================================================================
// PUBLIC UTILITIES
// ============================================================================

export const raw = (strings: TemplateStringsArray, ...values: unknown[]): RawSQL => ({
  _tag: 'RawSQL',
  strings,
  values,
});
export const fn = <N extends string, T = unknown>(name: N, args: unknown[] = []): OdmValue<T, N> => ({
  _tag: 'OdmValue',
  ast: Ast.val.func(name, args.map(toAstValue)),
});
export const count = (): OdmValue<number, 'count'> => fn('count') as OdmValue<number, 'count'>;
export const id = <Tb extends string>(
  table: Tb | { name: Tb },
  value: string | number | readonly unknown[] | object,
): SurrealID<Tb> => {
  const tableName = typeof table === 'string' ? table : table.name;
  return {
    _tag: 'SurrealID',
    table: tableName,
    value,
    toString: () =>
      `${tableName}:${Array.isArray(value) ? `[${value.map((v) => JSON.stringify(v)).join(',')}]` : JSON.stringify(value)}`,
  };
};

export const sql = <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => {
  return Effect.suspend(() => {
    const { sql: compiledSql, bindings } = new StatementBuilder().compile({
      type: 'RAW',
      strings,
      values,
    });
    return Effect.flatMap(SurrealEngine, (engine) =>
      engine.query<unknown>(compiledSql, bindings).pipe(
        Effect.map((rawResult) => normalizeValue(rawResult) as T[]),
      ),
    );
  });
};

// ============================================================================
// BASE EXECUTABLE QUERY
// ============================================================================

export abstract class ExecutableQuery<A, E = SurrealError> {
  constructor(protected engine: SurrealEngine) { }

  abstract toEffect(): Effect.Effect<A, E, never>;
  abstract getAst(): StatementNode;

  decodeResult(rawResult: unknown): Effect.Effect<A, SurrealError, never> {
    return Effect.succeed(normalizeValue(rawResult) as A);
  }

  [Symbol.iterator]() {
    return this.toEffect()[Symbol.iterator]();
  }

  pipe(...args: any[]) {
    return pipeArguments(this.toEffect(), args as any);
  }

  protected executeAst(ast: any): Effect.Effect<A, SurrealQueryError, never> {
    return Effect.suspend(() => {
      const { sql, bindings } = new StatementBuilder().compile(ast);
      return this.engine.query<unknown>(sql, bindings).pipe(
        Effect.map((res) => normalizeValue(res) as A),
      );
    });
  }
}

// ============================================================================
// FLUENT IMMUTABLE BUILDERS
// ============================================================================

type ExtractTableName<S extends string> = S extends `${infer Table}:${string}` ? Table : S;

type ResolveTarget<Docs extends readonly DocumentDef<any, any, any>[], T> = T extends string
  ? Extract<Docs[number], { name: ExtractTableName<T> }>
  : T extends SurrealID<infer N>
  ? Extract<Docs[number], { name: N }>
  : AnyDocumentDef;

type Doc<Docs extends readonly DocumentDef<any, any, any>[], T> = ExtractDocType<
  ResolveTarget<Docs, T>
>;

// ----------------------------------------------------------------------------
// SELECT BUILDER
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// CREATE BUILDER
// ----------------------------------------------------------------------------

interface CreateState {
  readonly only: boolean;
  readonly returns?: ReturnKeyword | readonly AnyFieldSpec[];
}

export class CreateBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  T,
  Only extends boolean = false,
  Ret extends ReturnKeyword | readonly AnyFieldSpec[] = 'AFTER',
> extends ExecutableQuery<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError> {
  constructor(
    engine: SurrealEngine,
    private readonly target: T,
    private readonly data: Doc<Docs, T> | readonly Doc<Docs, T>[],
    private readonly state: CreateState = { only: false },
    private readonly docDef?: AnyDocumentDef,
  ) {
    super(engine);
  }

  private clone<NewOnly extends boolean = Only, NewRet extends ReturnKeyword | readonly AnyFieldSpec[] = Ret>(
    patch: Partial<CreateState>,
  ): CreateBuilder<Docs, T, NewOnly, NewRet> {
    return new CreateBuilder<Docs, T, NewOnly, NewRet>(
      this.engine,
      this.target,
      this.data,
      { ...this.state, ...patch },
      this.docDef,
    );
  }

  first(): CreateBuilder<Docs, T, true, Ret> {
    return this.clone<true, Ret>({ only: true });
  }

  returns<K extends ReturnKeyword | readonly AnyFieldSpec[]>(
    ret: K,
  ): CreateBuilder<Docs, T, Only, K> {
    return this.clone<Only, K>({ returns: ret });
  }

  getAst(): CreateStatement {
    let target = this.target;
    if (isSurrealID(target)) {
      target = target.table as any;
    } else if (typeof target === 'string' && target.includes(':')) {
      target = target.slice(0, target.indexOf(':')) as any;
    }

    const builder = Ast.stmt.create().targets([parseTarget(target)]);
    if (this.state.only) builder.only(true);

    if (Array.isArray(this.data)) {
      builder.data(Ast.data.content(toAstValue(this.data)));
    } else {
      const assignments: Record<string, AstValue> = {};
      for (const [k, v] of Object.entries(this.data as unknown as Record<string, unknown>)) {
        assignments[k] = toAstValue(v);
      }
      builder.data(Ast.data.set(assignments));
    }

    if (this.state.returns) {
      if (Array.isArray(this.state.returns))
        builder.returns(Ast.ret.fields(this.state.returns.map(mapFieldSpec)));
      else builder.returns({ type: 'KEYWORD', value: this.state.returns as any });
    }

    return builder.build();
  }

  override decodeResult(
    rawResult: unknown,
  ): Effect.Effect<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    const normalized = normalizeValue(rawResult);
    const ret = this.state.returns;
    if (!this.docDef?.schema || ret === 'NONE' || ret === 'DIFF' || Array.isArray(ret)) {
      return Effect.succeed(normalized as ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>);
    }

    // Auto-detect whether a single record was created vs batch creation
    const isSingle = this.state.only || !Array.isArray(this.data);
    const actualResult =
      isSingle && Array.isArray(normalized)
        ? (normalized[0] ?? null)
        : !isSingle && !Array.isArray(normalized)
        ? (normalized === null || normalized === undefined ? [] : [normalized])
        : normalized;

    const s: Schema.Schema<any, any, never> = this.docDef.schema;
    const targetSchema: Schema.Schema<any, any, never> = isSingle
      ? s
      : (Schema.Array(s) as Schema.Schema<any, any, never>);

    return Schema.decodeUnknown(targetSchema)(actualResult).pipe(
      Effect.mapError(
        (issue) =>
          new SurrealDecodeError({
            issue,
            message: `Failed to decode created record against schema "${this.docDef?.name}": ${issue}`,
          }),
      ),
      Effect.map((res) => res as ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>),
    );
  }

  toEffect(): Effect.Effect<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    return Effect.suspend(() => {
      const statement = this.getAst();
      return this.executeAst(statement).pipe(
        Effect.flatMap((rawResult) => this.decodeResult(rawResult)),
      );
    });
  }
}

// ----------------------------------------------------------------------------
// UPDATE BUILDER
// ----------------------------------------------------------------------------

interface MutationState<TDoc> {
  readonly mode?: UpdateMode;
  readonly where?: WhereClause<TDoc>;
  readonly only: boolean;
  readonly returns?: ReturnKeyword | readonly AnyFieldSpec[];
  readonly timeout?: string;
}

export class UpdateBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  T,
  Only extends boolean = false,
  Ret extends ReturnKeyword | readonly AnyFieldSpec[] = 'AFTER',
> extends ExecutableQuery<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError> {
  constructor(
    engine: SurrealEngine,
    private readonly target: T,
    private readonly state: MutationState<Doc<Docs, T>> = { only: false },
    private readonly docDef?: AnyDocumentDef,
  ) {
    super(engine);
  }

  private clone<NewOnly extends boolean = Only, NewRet extends ReturnKeyword | readonly AnyFieldSpec[] = Ret>(
    patch: Partial<MutationState<Doc<Docs, T>>>,
  ): UpdateBuilder<Docs, T, NewOnly, NewRet> {
    return new UpdateBuilder<Docs, T, NewOnly, NewRet>(
      this.engine,
      this.target,
      { ...this.state, ...patch },
      this.docDef,
    );
  }

  set(data: Partial<Doc<Docs, T>>): UpdateBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'SET', data } });
  }
  merge(data: DeepPartial<Doc<Docs, T>>): UpdateBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'MERGE', data } });
  }
  unset(fields: FieldName<Doc<Docs, T>>[]): UpdateBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'UNSET', fields: fields as string[] } });
  }
  patch(patches: readonly unknown[]): UpdateBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'PATCH', data: patches } });
  }
  content(data: Doc<Docs, T> | readonly Doc<Docs, T>[]): UpdateBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'CONTENT', data } });
  }
  where(w: WhereClause<Doc<Docs, T>>): UpdateBuilder<Docs, T, Only, Ret> {
    const currentWhere = this.state.where;
    const combinedWhere: WhereClause<Doc<Docs, T>> = currentWhere
      ? { $and: [currentWhere, w] }
      : w;
    return this.clone({ where: combinedWhere });
  }
  first(): UpdateBuilder<Docs, T, true, Ret> {
    return this.clone<true, Ret>({ only: true });
  }
  timeout(duration: string): UpdateBuilder<Docs, T, Only, Ret> {
    return this.clone({ timeout: duration });
  }
  returns<K extends ReturnKeyword | readonly AnyFieldSpec[]>(
    ret: K,
  ): UpdateBuilder<Docs, T, Only, K> {
    return this.clone<Only, K>({ returns: ret });
  }

  getAst(): UpdateStatement {
    const builder = Ast.stmt.update().targets([parseTarget(this.target)]);
    if (this.state.only) builder.only(true);
    if (this.state.where) {
      const w = parseWhere(this.state.where);
      if (w) builder.where(w);
    }
    if (this.state.mode) builder.data(parseDataMode(this.state.mode));
    if (this.state.timeout) builder.timeout(this.state.timeout);

    const returnClause = this.state.returns ?? 'AFTER';
    if (Array.isArray(returnClause))
      builder.returns(Ast.ret.fields(returnClause.map(mapFieldSpec)));
    else builder.returns({ type: 'KEYWORD', value: returnClause as any });

    return builder.build();
  }

  override decodeResult(
    rawResult: unknown,
  ): Effect.Effect<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    const normalized = normalizeValue(rawResult);
    const ret = this.state.returns;
    if (!this.docDef?.schema || ret === 'NONE' || ret === 'DIFF' || Array.isArray(ret)) {
      return Effect.succeed(normalized as ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>);
    }

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
          message: `Record not found for update target: ${JSON.stringify(this.target)}`,
        }),
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
            message: `Failed to decode updated record against schema "${this.docDef?.name}": ${issue}`,
          }),
      ),
      Effect.map((res) => res as ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>),
    );
  }

  toEffect(): Effect.Effect<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    return Effect.suspend(() => {
      const statement = this.getAst();
      return this.executeAst(statement).pipe(
        Effect.flatMap((rawResult) => this.decodeResult(rawResult)),
      );
    });
  }
}

// ----------------------------------------------------------------------------
// UPSERT BUILDER
// ----------------------------------------------------------------------------

export class UpsertBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  T,
  Only extends boolean = false,
  Ret extends ReturnKeyword | readonly AnyFieldSpec[] = 'AFTER',
> extends ExecutableQuery<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError> {
  constructor(
    engine: SurrealEngine,
    private readonly target: T,
    private readonly state: MutationState<Doc<Docs, T>> = { only: false },
    private readonly docDef?: AnyDocumentDef,
  ) {
    super(engine);
  }

  private clone<NewOnly extends boolean = Only, NewRet extends ReturnKeyword | readonly AnyFieldSpec[] = Ret>(
    patch: Partial<MutationState<Doc<Docs, T>>>,
  ): UpsertBuilder<Docs, T, NewOnly, NewRet> {
    return new UpsertBuilder<Docs, T, NewOnly, NewRet>(
      this.engine,
      this.target,
      { ...this.state, ...patch },
      this.docDef,
    );
  }

  set(data: Partial<Doc<Docs, T>>): UpsertBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'SET', data } });
  }
  merge(data: DeepPartial<Doc<Docs, T>>): UpsertBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'MERGE', data } });
  }
  unset(fields: FieldName<Doc<Docs, T>>[]): UpsertBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'UNSET', fields: fields as string[] } });
  }
  patch(patches: readonly unknown[]): UpsertBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'PATCH', data: patches } });
  }
  content(data: Doc<Docs, T> | readonly Doc<Docs, T>[]): UpsertBuilder<Docs, T, Only, Ret> {
    return this.clone({ mode: { type: 'CONTENT', data } });
  }
  where(w: WhereClause<Doc<Docs, T>>): UpsertBuilder<Docs, T, Only, Ret> {
    const currentWhere = this.state.where;
    const combinedWhere: WhereClause<Doc<Docs, T>> = currentWhere
      ? { $and: [currentWhere, w] }
      : w;
    return this.clone({ where: combinedWhere });
  }
  first(): UpsertBuilder<Docs, T, true, Ret> {
    return this.clone<true, Ret>({ only: true });
  }
  timeout(duration: string): UpsertBuilder<Docs, T, Only, Ret> {
    return this.clone({ timeout: duration });
  }
  returns<K extends ReturnKeyword | readonly AnyFieldSpec[]>(
    ret: K,
  ): UpsertBuilder<Docs, T, Only, K> {
    return this.clone<Only, K>({ returns: ret });
  }

  getAst(): UpsertStatement {
    const builder = Ast.stmt.upsert().targets([parseTarget(this.target)]);
    if (this.state.only) builder.only(true);
    if (this.state.where) {
      const w = parseWhere(this.state.where);
      if (w) builder.where(w);
    }
    if (this.state.mode) builder.data(parseDataMode(this.state.mode));
    if (this.state.timeout) builder.timeout(this.state.timeout);

    const returnClause = this.state.returns ?? 'AFTER';
    if (Array.isArray(returnClause))
      builder.returns(Ast.ret.fields(returnClause.map(mapFieldSpec)));
    else builder.returns({ type: 'KEYWORD', value: returnClause as any });

    return builder.build();
  }

  override decodeResult(
    rawResult: unknown,
  ): Effect.Effect<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    const normalized = normalizeValue(rawResult);
    const ret = this.state.returns;
    if (!this.docDef?.schema || ret === 'NONE' || ret === 'DIFF' || Array.isArray(ret)) {
      return Effect.succeed(normalized as ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>);
    }

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
          message: `Record not found for upsert target: ${JSON.stringify(this.target)}`,
        }),
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
            message: `Failed to decode upserted record against schema "${this.docDef?.name}": ${issue}`,
          }),
      ),
      Effect.map((res) => res as ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>),
    );
  }

  toEffect(): Effect.Effect<ResolveUpdateReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    return Effect.suspend(() => {
      const statement = this.getAst();
      return this.executeAst(statement).pipe(
        Effect.flatMap((rawResult) => this.decodeResult(rawResult)),
      );
    });
  }
}

// ----------------------------------------------------------------------------
// DELETE BUILDER
// ----------------------------------------------------------------------------

interface DeleteState<TDoc> {
  readonly where?: WhereClause<TDoc>;
  readonly only: boolean;
  readonly returns?: ReturnKeyword | readonly AnyFieldSpec[];
  readonly timeout?: string;
}

export class DeleteBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  T,
  Only extends boolean = false,
  Ret extends ReturnKeyword | readonly AnyFieldSpec[] = 'NONE',
> extends ExecutableQuery<ResolveDeleteReturn<Doc<Docs, T>, Only, Ret>, SurrealError> {
  constructor(
    engine: SurrealEngine,
    private readonly target: T,
    private readonly state: DeleteState<Doc<Docs, T>> = { only: false },
    private readonly docDef?: AnyDocumentDef,
  ) {
    super(engine);
  }

  private clone<NewOnly extends boolean = Only, NewRet extends ReturnKeyword | readonly AnyFieldSpec[] = Ret>(
    patch: Partial<DeleteState<Doc<Docs, T>>>,
  ): DeleteBuilder<Docs, T, NewOnly, NewRet> {
    return new DeleteBuilder<Docs, T, NewOnly, NewRet>(
      this.engine,
      this.target,
      { ...this.state, ...patch },
      this.docDef,
    );
  }

  where(w: WhereClause<Doc<Docs, T>>): DeleteBuilder<Docs, T, Only, Ret> {
    const currentWhere = this.state.where;
    const combinedWhere: WhereClause<Doc<Docs, T>> = currentWhere
      ? { $and: [currentWhere, w] }
      : w;
    return this.clone({ where: combinedWhere });
  }
  first(): DeleteBuilder<Docs, T, true, Ret> {
    return this.clone<true, Ret>({ only: true });
  }
  timeout(t: string): DeleteBuilder<Docs, T, Only, Ret> {
    return this.clone({ timeout: t });
  }
  returns<K extends ReturnKeyword | readonly AnyFieldSpec[]>(
    ret: K,
  ): DeleteBuilder<Docs, T, Only, K> {
    return this.clone<Only, K>({ returns: ret });
  }

  getAst(): DeleteStatement {
    const builder = Ast.stmt.delete().targets([parseTarget(this.target)]);
    if (this.state.only) builder.only(true);
    if (this.state.where) {
      const w = parseWhere(this.state.where);
      if (w) builder.where(w);
    }
    if (this.state.timeout) builder.timeout(this.state.timeout);
    if (this.state.returns) {
      if (Array.isArray(this.state.returns))
        builder.returns(Ast.ret.fields(this.state.returns.map(mapFieldSpec)));
      else builder.returns({ type: 'KEYWORD', value: this.state.returns as any });
    }
    return builder.build();
  }

  override decodeResult(
    rawResult: unknown,
  ): Effect.Effect<ResolveDeleteReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    const normalized = normalizeValue(rawResult);
    const ret = this.state.returns;
    if (!this.docDef?.schema || !ret || ret === 'NONE' || ret === 'DIFF' || Array.isArray(ret)) {
      return Effect.succeed(normalized as ResolveDeleteReturn<Doc<Docs, T>, Only, Ret>);
    }

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
          message: `Record not found for delete target: ${JSON.stringify(this.target)}`,
        }),
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
            message: `Failed to decode deleted record against schema "${this.docDef?.name}": ${issue}`,
          }),
      ),
      Effect.map((res) => res as ResolveDeleteReturn<Doc<Docs, T>, Only, Ret>),
    );
  }

  toEffect(): Effect.Effect<ResolveDeleteReturn<Doc<Docs, T>, Only, Ret>, SurrealError, never> {
    return Effect.suspend(() => {
      const statement = this.getAst();
      return this.executeAst(statement).pipe(
        Effect.flatMap((rawResult) => this.decodeResult(rawResult)),
      );
    });
  }
}

// ----------------------------------------------------------------------------
// INSERT BUILDER
// ----------------------------------------------------------------------------

interface InsertState {
  readonly relation?: boolean;
  readonly ignore?: boolean;
  readonly onDuplicate?: UpdateMode;
  readonly returns?: ReturnKeyword | readonly AnyFieldSpec[];
}

export class InsertBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  T,
  Ret = any,
> extends ExecutableQuery<Ret, SurrealError> {
  constructor(
    engine: SurrealEngine,
    private readonly target: T,
    private readonly data: Doc<Docs, T> | readonly Doc<Docs, T>[],
    private readonly state: InsertState = {},
    private readonly docDef?: AnyDocumentDef,
  ) {
    super(engine);
  }

  private clone<NewRet = Ret>(patch: Partial<InsertState>): InsertBuilder<Docs, T, NewRet> {
    return new InsertBuilder<Docs, T, NewRet>(
      this.engine,
      this.target,
      this.data,
      { ...this.state, ...patch },
      this.docDef,
    );
  }

  relation(isRel = true): InsertBuilder<Docs, T, Ret> {
    return this.clone({ relation: isRel });
  }

  ignore(isIgnore = true): InsertBuilder<Docs, T, Ret> {
    return this.clone({ ignore: isIgnore });
  }

  onDuplicate(data: Partial<Doc<Docs, T>>): InsertBuilder<Docs, T, Ret> {
    return this.clone({ onDuplicate: { type: 'SET', data } });
  }

  returns<K extends ReturnKeyword | readonly AnyFieldSpec[]>(ret: K): InsertBuilder<Docs, T, K> {
    return this.clone<K>({ returns: ret });
  }

  getAst(): InsertStatement {
    const builder = Ast.stmt.insert().into(parseTarget(this.target));
    if (this.state.relation) builder.relation(true);
    if (this.state.ignore) builder.ignore(true);

    if (Array.isArray(this.data)) {
      builder.data(this.data.map(toAstValue));
    } else {
      builder.data(toAstValue(this.data));
    }

    if (this.state.onDuplicate) {
      builder.onDuplicate(parseDataMode(this.state.onDuplicate));
    }

    if (this.state.returns) {
      if (Array.isArray(this.state.returns))
        builder.returns(Ast.ret.fields(this.state.returns.map(mapFieldSpec)));
      else builder.returns({ type: 'KEYWORD', value: this.state.returns as any });
    }

    return builder.build();
  }

  override decodeResult(rawResult: unknown): Effect.Effect<Ret, SurrealError, never> {
    const normalized = normalizeValue(rawResult);
    const ret = this.state.returns;
    if (!this.docDef?.schema || ret === 'NONE' || ret === 'DIFF' || Array.isArray(ret)) {
      return Effect.succeed(normalized as Ret);
    }

    const isSingle = !Array.isArray(this.data);
    const actualResult =
      isSingle && Array.isArray(normalized)
        ? (normalized[0] ?? null)
        : !isSingle && !Array.isArray(normalized)
        ? (normalized === null || normalized === undefined ? [] : [normalized])
        : normalized;

    const s: Schema.Schema<any, any, never> = this.docDef.schema;
    const targetSchema: Schema.Schema<any, any, never> = isSingle
      ? s
      : (Schema.Array(s) as Schema.Schema<any, any, never>);

    return Schema.decodeUnknown(targetSchema)(actualResult).pipe(
      Effect.mapError(
        (issue) =>
          new SurrealDecodeError({
            issue,
            message: `Failed to decode inserted record against schema "${this.docDef?.name}": ${issue}`,
          }),
      ),
      Effect.map((res) => res as Ret),
    );
  }

  toEffect(): Effect.Effect<Ret, SurrealError, never> {
    return Effect.suspend(() => {
      const statement = this.getAst();
      return this.executeAst(statement).pipe(
        Effect.flatMap((rawResult) => this.decodeResult(rawResult)),
      );
    });
  }
}

// ----------------------------------------------------------------------------
// RELATE BUILDER
// ----------------------------------------------------------------------------

interface RelateState {
  readonly to?: AstValue;
  readonly only?: boolean;
  readonly mode?: UpdateMode;
  readonly returns?: ReturnKeyword | readonly AnyFieldSpec[];
}

export class RelateBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  T,
  Ret = any,
> extends ExecutableQuery<Ret, SurrealError> {
  constructor(
    engine: SurrealEngine,
    private readonly fromTarget: T,
    private readonly edgeName: string,
    private readonly state: RelateState = {},
  ) {
    super(engine);
  }

  private clone<NewRet = Ret>(patch: Partial<RelateState>): RelateBuilder<Docs, T, NewRet> {
    return new RelateBuilder<Docs, T, NewRet>(
      this.engine,
      this.fromTarget,
      this.edgeName,
      { ...this.state, ...patch },
    );
  }

  to(target: SurrealID | string | RawSQL): RelateBuilder<Docs, T, Ret> {
    return this.clone({ to: parseTarget(target) });
  }
  first(): RelateBuilder<Docs, T, Ret> {
    return this.clone({ only: true });
  }
  set(data: Record<string, unknown>): RelateBuilder<Docs, T, Ret> {
    return this.clone({ mode: { type: 'SET', data } });
  }
  returns<K extends ReturnKeyword | readonly AnyFieldSpec[]>(ret: K): RelateBuilder<Docs, T, K> {
    return this.clone<K>({ returns: ret });
  }

  getAst(): RelateStatement {
    if (!this.state.to) {
      throw new Error("[ODM] Relate query is missing a 'to()' target.");
    }
    const builder = Ast.stmt
      .relate()
      .from(parseTarget(this.fromTarget))
      .edge(Ast.val.ident(this.edgeName))
      .to(this.state.to);
    if (this.state.only) builder.only(true);
    if (this.state.mode) builder.data(parseDataMode(this.state.mode));
    if (this.state.returns) {
      if (Array.isArray(this.state.returns))
        builder.returns(Ast.ret.fields(this.state.returns.map(mapFieldSpec)));
      else builder.returns({ type: 'KEYWORD', value: this.state.returns as any });
    }
    return builder.build();
  }

  toEffect(): Effect.Effect<Ret, SurrealError, never> {
    return Effect.suspend(() => {
      if (!this.state.to) {
        return Effect.fail(
          new SurrealQueryError({
            sql: '',
            bindings: {},
            cause: new Error("Missing 'to()' target"),
            message: "[ODM] Relate query is missing a 'to()' target.",
          }),
        );
      }
      return this.executeAst(this.getAst()).pipe(
        Effect.flatMap((rawResult) => this.decodeResult(rawResult)),
      );
    });
  }
}

// ----------------------------------------------------------------------------
// TRANSACTION BUILDER
// ----------------------------------------------------------------------------

export type AnyExecutableQuery = ExecutableQuery<any, SurrealError>;
export type ExtractQueryReturn<Q> = Q extends ExecutableQuery<infer R, any> ? R : never;

export class TransactionBuilder<
  Docs extends readonly DocumentDef<any, any, any>[],
  Results extends readonly unknown[] = [],
> extends ExecutableQuery<Results, SurrealError> {
  constructor(
    engine: SurrealEngine,
    public readonly db: DatabaseSchema<Docs>,
    private readonly operations: readonly AnyExecutableQuery[] = [],
  ) {
    super(engine);
  }

  add<Q extends AnyExecutableQuery>(
    query: Q,
  ): TransactionBuilder<Docs, [...Results, ExtractQueryReturn<Q>]> {
    return new TransactionBuilder<Docs, [...Results, ExtractQueryReturn<Q>]>(
      this.engine,
      this.db,
      [...this.operations, query],
    );
  }

  getAst(): TransactionStatement {
    return {
      type: 'TRANSACTION',
      statements: this.operations.map((op) => op.getAst()),
    };
  }

  toEffect(): Effect.Effect<Results, SurrealError, never> {
    if (this.operations.length === 0) {
      return Effect.succeed([] as unknown as Results);
    }

    return Effect.suspend(() => {
      const ast = this.getAst();
      const { sql, bindings } = new StatementBuilder().compile(ast);
      const queryExec = this.engine.queryRaw
        ? this.engine.queryRaw(sql, bindings)
        : this.engine.query<unknown[]>(sql, bindings);

      return queryExec.pipe(
        Effect.flatMap(
          (response): Effect.Effect<Results, SurrealError, never> => {
            let unwrapped: unknown[];
            try {
              unwrapped = unwrapSurrealTransactionResults(response, this.operations.length);
            } catch (cause) {
              return Effect.fail(
                new SurrealQueryError({
                  sql,
                  bindings,
                  cause,
                  message: `Transaction execution failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                }),
              );
            }

            const decoders = this.operations.map((op, i) => op.decodeResult(unwrapped[i]));
            return Effect.all(decoders) as unknown as Effect.Effect<Results, SurrealError, never>;
          },
        ),
      );
    });
  }
}

// ============================================================================
// DBSCHEMA ENTRY POINT
// ============================================================================

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
