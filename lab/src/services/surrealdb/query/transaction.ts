// Transaction builder that batches executable queries atomically.
import * as Effect from 'effect/Effect';

import type { DocumentDef } from '../api';
import type { TransactionStatement } from '../ast';
import type { SurrealError } from '../engine';
import {
  SurrealEngine,
  SurrealQueryError,
  unwrapSurrealTransactionResults,
} from '../engine';
import { StatementBuilder } from '../statement-builder';
import {
  type AnyExecutableQuery,
  type ExtractQueryReturn,
  ExecutableQuery,
} from './executable';
import type { DatabaseSchema } from './schema';

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
