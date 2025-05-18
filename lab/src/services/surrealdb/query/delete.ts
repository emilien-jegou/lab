// Fluent immutable DELETE query builder and its state.
import { Schema } from 'effect';
import * as Effect from 'effect/Effect';

import type {
  AnyFieldSpec,
  DocumentDef,
  ResolveDeleteReturn,
  ReturnKeyword,
  WhereClause,
} from '../api';
import type { DeleteStatement } from '../ast';
import { Ast } from '../ast-builder';
import type { SurrealError } from '../engine';
import {
  normalizeValue,
  SurrealDecodeError,
  SurrealEngine,
  SurrealRecordNotFoundError,
} from '../engine';
import { mapFieldSpec, parseTarget, parseWhere } from './ast-helpers';
import { type AnyDocumentDef, type Doc, ExecutableQuery } from './executable';

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
