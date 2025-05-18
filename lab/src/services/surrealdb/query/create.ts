// Fluent immutable CREATE query builder and its state.
import { Schema } from 'effect';
import * as Effect from 'effect/Effect';

import type {
  AnyFieldSpec,
  DocumentDef,
  ResolveUpdateReturn,
  ReturnKeyword,
} from '../api';
import type { AstValue, CreateStatement } from '../ast';
import { Ast } from '../ast-builder';
import type { SurrealError } from '../engine';
import {
  normalizeValue,
  SurrealDecodeError,
  SurrealEngine,
} from '../engine';
import { isSurrealID, mapFieldSpec, parseTarget, toAstValue } from './ast-helpers';
import { type AnyDocumentDef, type Doc, ExecutableQuery } from './executable';

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
