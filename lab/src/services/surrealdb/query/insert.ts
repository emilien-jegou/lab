// Fluent immutable INSERT query builder and its state.
import { Schema } from 'effect';
import * as Effect from 'effect/Effect';

import type {
  AnyFieldSpec,
  DocumentDef,
  ReturnKeyword,
  UpdateMode,
} from '../api';
import type { InsertStatement } from '../ast';
import { Ast } from '../ast-builder';
import type { SurrealError } from '../engine';
import {
  normalizeValue,
  SurrealDecodeError,
  SurrealEngine,
} from '../engine';
import { mapFieldSpec, parseDataMode, parseTarget, toAstValue } from './ast-helpers';
import { type AnyDocumentDef, type Doc, ExecutableQuery } from './executable';

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
