// lab/src/services/surrealdb/api.ts
import { Schema } from "effect";
import type { Pipe, Strings, Tuples, Objects } from "hotscript";
import type { DeepKeys, DeepValue } from "./utils";

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined | null;

export type DeepPartial<T> = T extends Builtin
  ? T
  : T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepPartial<U>>
  : { [K in keyof T]?: DeepPartial<T[K]> };

export type IsAny<T> = 0 extends (1 & T) ? true : false;
export type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

export interface RelDef<Edge extends string, TargetDoc> {
  readonly edge: Edge;
  readonly target: TargetDoc;
}

export function rel<Edge extends string, TargetDoc>(edge: Edge, target: TargetDoc): RelDef<Edge, TargetDoc> {
  return { edge, target };
}

export interface DocumentDef<
  Name extends string = string,
  S extends Schema.Schema<any, any, never> = Schema.Schema<any, any, never>,
  Rels extends readonly RelDef<any, any>[] = []
> {
  readonly name: Name;
  readonly schema: S;
  readonly relations: Rels;
}

export function document<
  Name extends string,
  S extends Schema.Schema<any, any, never>,
  Rels extends readonly RelDef<any, any>[] = []
>(
  name: Name,
  schema: S,
  relations?: Rels
): DocumentDef<Name, S, Rels> {
  return { name, schema, relations: relations ?? ([] as unknown as Rels) };
}

export type ExtractDocType<D> = D extends DocumentDef<any, infer S, any> ? Schema.Schema.Type<S> : never;

// ============================================================================
// CORE TYPES & ODM PRIMITIVES
// ============================================================================

export type LiveAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface LiveNotification<T = unknown> {
  readonly action: LiveAction;
  readonly result: T;
  readonly queryId?: string;
}

export interface RawSQL {
  readonly _tag: "RawSQL";
  readonly strings: TemplateStringsArray;
  readonly values: readonly unknown[];
}

export interface OdmValue<T = unknown, N extends string = string> {
  readonly _tag: "OdmValue";
  readonly ast: any;
  readonly _type?: T;
  readonly _name?: N;
}

export interface OdmCondition {
  readonly _tag: "OdmCondition";
  readonly ast: any;
}

export interface SurrealID<Tb extends string = string> {
  readonly _tag: "SurrealID";
  readonly table: Tb;
  readonly value: string | number | readonly unknown[] | object;
  readonly toString: () => string;
}

export type ReturnKeyword = "NONE" | "BEFORE" | "AFTER" | "DIFF" | (string & {});

// ============================================================================
// FIELD SPEC TAGGED UNION
// ============================================================================

export interface FieldSpec<N extends string = string> { readonly _tag: "Field"; readonly name: N; }
export interface AsSpec<F extends string | OdmValue<any> = string | OdmValue<any>, A extends string = string> { 
  readonly _tag: "As"; readonly field: F; readonly alias: A; 
}
export interface RelSpec<P extends string = string> { readonly _tag: "Rel"; readonly path: P; }

export type AnyFieldSpec = FieldSpec<any> | AsSpec<any, any> | RelSpec<any> | OdmValue<any>;

export const field = <N extends string>(name: N): FieldSpec<N> => ({ _tag: "Field", name });
export const as_ = <F extends string | OdmValue<any>, A extends string>(f: F, alias: A): AsSpec<F, A> => ({ _tag: "As", field: f, alias });
export const relPath = <P extends string>(path: P): RelSpec<P> => ({ _tag: "Rel", path });

// Strictly typed field names: only keys of T, deep nested dot paths, or string if schemaless
export type FieldName<T> = IsAny<T> extends true
  ? string
  : IsUnknown<T> extends true
  ? string
  : (keyof T & string) | DeepKeys<T>;

export type SelectInput<T = unknown> =
  | FieldName<T>
  | (IsAny<T> extends true
      ? AsSpec<string | OdmValue<any>, string>
      : IsUnknown<T> extends true
      ? AsSpec<string | OdmValue<any>, string>
      : AsSpec<FieldName<T> | OdmValue<any>, string>)
  | RelSpec<any>
  | OdmValue<any>;

export type ToFieldSpec<T> = T extends FieldSpec<any>
  ? T
  : T extends AsSpec<any, any>
  ? T
  : T extends RelSpec<any>
  ? T
  : T extends OdmValue<any>
  ? T
  : T extends string
  ? FieldSpec<T>
  : AnyFieldSpec;

// ============================================================================
// GRAPH RETURN TYPE & PROJECTION
// ============================================================================

export type SchemaDB<Docs extends readonly DocumentDef<any, any, any>[]> = {
  [D in Docs[number] as D["name"]]: ExtractDocType<D>;
};

export type GraphReturnType<DB, Query extends string> = Pipe<
  Query,
  [
    Strings.Split<"<-">,   Tuples.Join<"->">,
    Strings.Split<"<->">,  Tuples.Join<"->">,
    Strings.Split<"->">,
    Tuples.Last,
    Strings.Split<".">,
  ]
> extends [infer Table extends keyof DB, ...infer Path extends string[]]
  ? Path extends [] | ["*"] ? DB[Table][] : Pipe<DB[Table], [Objects.Get<Pipe<Path, [Tuples.Join<".">]>>]> extends infer R ? R[] : never
  : never;

export type SpecAlias<S extends AnyFieldSpec> =
  S extends AsSpec<any, infer A> ? A :
  S extends FieldSpec<infer N>   ? N :
  S extends RelSpec<infer P>     ? P :
  S extends OdmValue<any, infer N> ? (string extends N ? string : N) : never;

export type SpecValue<T, S extends AnyFieldSpec, DB> =
  S extends RelSpec<infer P> ? GraphReturnType<DB, P> :
  S extends AsSpec<infer F, any> ? (
    F extends OdmValue<infer V, any> ? V :
    IsAny<T> extends true ? any :
    IsUnknown<T> extends true ? unknown :
    F extends string ? DeepValue<T, F> : unknown
  ) :
  S extends OdmValue<infer V, any> ? V :
  S extends FieldSpec<infer N> ? (
    IsAny<T> extends true ? any :
    IsUnknown<T> extends true ? unknown :
    N extends string ? DeepValue<T, N> : unknown
  ) : never;

export type ProjectFields<T, Specs extends readonly AnyFieldSpec[], DB> =
  Specs extends [] | readonly [] ? T : { readonly [S in Specs[number] as SpecAlias<S>]: SpecValue<T, S, DB> };

export type WrapOnly<Result, Only extends boolean> = Only extends true ? Result : Result[];

export type ResolveUpdateReturn<T, Only extends boolean, Ret> =
  Ret extends "NONE" ? void :
  Ret extends "DIFF" ? Record<string, unknown>[] :
  Ret extends readonly AnyFieldSpec[] ? WrapOnly<ProjectFields<T, Ret, {}>, Only> :
  WrapOnly<T, Only>;

export type ResolveDeleteReturn<T, Only extends boolean, Ret> =
  Ret extends "NONE" ? void :
  ResolveUpdateReturn<T, Only, Ret>;

// ============================================================================
// WHERE CLAUSES & OPERATORS
// ============================================================================

export type OperatorMap<V> = {
  readonly $eq?: V;
  readonly $not?: V;
  readonly $exact?: V;
  readonly $fuzzy?: V | string;
  readonly $notFuzzy?: V | string;
  readonly $anyEq?: V;
  readonly $allEq?: V;
  readonly $anyFuzzy?: V | string;
  readonly $allFuzzy?: V | string;
  readonly $lt?: V;
  readonly $lte?: V;
  readonly $gt?: V;
  readonly $gte?: V;
  readonly $contains?: any;
  readonly $notContains?: any;
  readonly $containsAll?: any[];
  readonly $containsAny?: any[];
  readonly $containsNone?: any[];
  readonly $in?: any[];
  readonly $notIn?: any[];
  readonly $allIn?: any[];
  readonly $anyIn?: any[];
  readonly $noneIn?: any[];
  readonly $outside?: any;
  readonly $intersects?: any;
  readonly $search?: string;
  readonly $knn?: [k: number, metric: string, target?: unknown];
};

export type WhereField<V> = V | OperatorMap<V>;

export type WhereConditions<T> = IsAny<T> extends true
  ? Record<string, unknown>
  : IsUnknown<T> extends true
  ? Record<string, unknown>
  : {
      readonly [K in (keyof T & string)]?: WhereField<T[K]>;
    } & {
      readonly [K in DeepKeys<T>]?: WhereField<DeepValue<T, K>>;
    };

export type WhereOperators<T> = {
  readonly $and?: readonly WhereClause<T>[];
  readonly $or?: readonly WhereClause<T>[];
  readonly $nullish?: readonly [FieldName<T>, boolean];
  readonly $raw?: RawSQL | readonly RawSQL[];
  readonly $expr?: OdmCondition | readonly OdmCondition[];
};

export type WhereClause<T = any> =
  | WhereOperators<T>
  | (WhereConditions<T> & WhereOperators<T>);


export interface OrderClause<T = any> {
  readonly field: FieldName<T>;
  readonly direction?: "ASC" | "DESC";
  readonly collate?: boolean;
  readonly numeric?: boolean;
}

export type UpdateMode =
  | { readonly type: "SET";     readonly data: any }
  | { readonly type: "UNSET";   readonly fields: readonly string[] }
  | { readonly type: "MERGE";   readonly data: any }
  | { readonly type: "CONTENT"; readonly data: any }
  | { readonly type: "PATCH";   readonly data: readonly any[] };
