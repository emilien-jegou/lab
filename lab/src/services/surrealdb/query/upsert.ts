// Fluent immutable UPSERT query builder.
import { Schema } from 'effect';
import * as Effect from 'effect/Effect';

import type {
  AnyFieldSpec,
  DeepPartial,
  DocumentDef,
  FieldName,
  ResolveUpdateReturn,
  ReturnKeyword,
  WhereClause,
} from '../api';
import type { UpsertStatement } from '../ast';
import { Ast } from '../ast-builder';
import type { SurrealError } from '../engine';
import {
  normalizeValue,
  SurrealDecodeError,
  SurrealEngine,
  SurrealRecordNotFoundError,
} from '../engine';
import { mapFieldSpec, parseDataMode, parseTarget, parseWhere } from './ast-helpers';
import { type AnyDocumentDef, type Doc, ExecutableQuery } from './executable';
import type { MutationState } from './update';

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
