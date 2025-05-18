import { Schema } from 'effect';
import * as Effect from 'effect/Effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema, id } from '../../api-builder';
import { SurrealEngine, SurrealQueryError } from '../../engine';

const AccountDoc = document('account', Schema.Struct({ balance: Schema.Number }));

describe('Transaction Builder & Multi-Result Unwrapping', () => {
  it('executes multi-statement transactions and unwraps individual statement results', () => {
    const mockRawResults = [
      { status: 'OK', result: null }, // BEGIN TRANSACTION
      { status: 'OK', result: [{ balance: 100 }] }, // op 1
      { status: 'OK', result: [{ balance: 200 }] }, // op 2
      { status: 'OK', result: null }, // COMMIT TRANSACTION
    ];

    const engine = SurrealEngine.of({
      query: () => Effect.fail(new Error('Should not call query() for transaction') as any),
      queryRaw: () => Effect.succeed(mockRawResults),
    });

    const db = dbschema(AccountDoc).connect(engine);

    const tx = db.transaction((t) => [
      t.doc(id('account', '1')).update().set({ balance: 100 }).first(),
      t.doc(id('account', '2')).update().set({ balance: 200 }).first(),
    ]);

    const results = Effect.runSync(tx.toEffect());
    expect(results).toEqual([{ balance: 100 }, { balance: 200 }]);
  });

  it('fails the transaction effect when SurrealDB returns an error item in transaction', () => {
    const mockRawResults = [
      { status: 'OK', result: null },
      { status: 'ERR', detail: 'Database transaction lock failed' },
      { status: 'OK', result: null },
    ];

    const engine = SurrealEngine.of({
      query: () => Effect.dieMessage('unreachable'),
      queryRaw: () => Effect.succeed(mockRawResults),
    });

    const db = dbschema(AccountDoc).connect(engine);
    const tx = db.transaction((t) => [t.doc('account').select()]);

    const exit = Effect.runSyncExit(tx.toEffect());
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const err = exit.cause as any;
      expect(err.error._tag).toBe('SurrealQueryError');
      expect(err.error.message).toContain('Database transaction lock failed');
    }
  });
});
