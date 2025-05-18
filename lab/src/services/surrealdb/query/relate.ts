// Fluent immutable RELATE (graph edge) query builder and its state.
import * as Effect from 'effect/Effect';

import type {
  AnyFieldSpec,
  DocumentDef,
  RawSQL,
  ReturnKeyword,
  SurrealID,
  UpdateMode,
} from '../api';
import type { AstValue, RelateStatement } from '../ast';
import { Ast } from '../ast-builder';
import type { SurrealError } from '../engine';
import { SurrealEngine, SurrealQueryError } from '../engine';
import { mapFieldSpec, parseDataMode, parseTarget } from './ast-helpers';
import { ExecutableQuery } from './executable';

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
