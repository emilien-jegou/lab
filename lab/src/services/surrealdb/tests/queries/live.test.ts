import { Schema } from 'effect';
import * as Chunk from 'effect/Chunk';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import { describe, it, expect, vi } from 'vitest';

import { document } from '../../api';
import type { LiveNotification } from '../../api';
import { dbschema } from '../../api-builder';
import type { SelectStatement } from '../../ast';
import { createMockEngine, useAstCapture } from '../test-utils';

const UserDoc = document(
  'user',
  Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    role: Schema.Literal('admin', 'member'),
  }),
);

describe('SurrealDB LIVE SELECT Queries', () => {
  const { capture } = useAstCapture();

  describe('SurrealQL Compilation', () => {
    it('compiles standard LIVE SELECT statements', () => {
      const db = dbschema(UserDoc).connect(createMockEngine());
      const ast = capture<SelectStatement>(db.doc('user').select().live());

      expect(ast.type).toBe('SELECT');
      expect(ast.live).toBe(true);
      expect(ast.diff).toBeUndefined();
    });

    it('compiles LIVE SELECT DIFF statements', () => {
      const db = dbschema(UserDoc).connect(createMockEngine());
      const ast = capture<SelectStatement>(db.doc('user').select().live({ diff: true }));

      expect(ast.live).toBe(true);
      expect(ast.diff).toBe(true);
    });

    it('compiles filtered LIVE SELECT with parameter bindings', () => {
      const db = dbschema(UserDoc).connect(createMockEngine());
      const ast = capture<SelectStatement>(
        db.doc('user').select('name', 'email').where({ role: 'admin' }).live(),
      );

      expect(ast.live).toBe(true);
      expect(ast.where).toBeDefined();
    });
  });

  describe('Effect.Stream Lifecycle & Execution', () => {
    it('emits notifications as an Effect.Stream and handles finalization', async () => {
      let listener: ((n: LiveNotification<any>) => void) | undefined;
      const killSpy = vi.fn();

      const engine = createMockEngine([], (_sql, _bindings, onNotification) => {
        listener = onNotification;
        return () => {
          killSpy();
        };
      });

      const db = dbschema(UserDoc).connect(engine);
      const stream = db.doc('user').select().where({ role: 'admin' }).live();

      // Collect the first 2 notifications emitted from the stream
      const consumeEffect = Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          stream.pipe(
            Stream.take(2),
            Stream.runCollect,
          ),
        );

        // Allow fiber to start and subscribe
        yield* Effect.yieldNow();

        // Emit 2 live updates
        listener?.({
          action: 'CREATE',
          result: { name: 'Alice', email: 'alice@test.com', role: 'admin' },
          queryId: 'test-uuid',
        });
        listener?.({
          action: 'UPDATE',
          result: { name: 'Alice M.', email: 'alice@test.com', role: 'admin' },
          queryId: 'test-uuid',
        });

        const chunk = yield* Effect.fromFiber(fiber);
        return Chunk.toArray(chunk);
      });

      const results = await Effect.runPromise(consumeEffect);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        action: 'CREATE',
        result: { name: 'Alice', email: 'alice@test.com', role: 'admin' },
        queryId: 'test-uuid',
      });
      expect(results[1]).toEqual({
        action: 'UPDATE',
        result: { name: 'Alice M.', email: 'alice@test.com', role: 'admin' },
        queryId: 'test-uuid',
      });

      // Verifies Stream finalizer / SurrealDB kill callback was called on completion
      expect(killSpy).toHaveBeenCalledTimes(1);
    });

    it('fails the stream with SurrealDecodeError if event payload violates schema', async () => {
      let listener: ((n: LiveNotification<any>) => void) | undefined;
      const engine = createMockEngine([], (_sql, _bindings, onNotification) => {
        listener = onNotification;
        return () => {};
      });

      const db = dbschema(UserDoc).connect(engine);
      const stream = db.doc('user').select().live();

      const testEffect = Effect.gen(function* () {
        const fiber = yield* Effect.fork(Stream.runHead(stream));
        yield* Effect.yieldNow();

        // Emit an invalid record violating schema
        listener?.({
          action: 'CREATE',
          result: { name: 'Bob', role: 'not-a-valid-role' },
        });

        return yield* Effect.fromFiber(fiber);
      });

      const exit = await Effect.runPromiseExit(testEffect);
      expect(exit._tag).toBe('Failure');

      if (exit._tag === 'Failure') {
        const err = exit.cause as any;
        expect(err.error._tag).toBe('SurrealDecodeError');
        expect(err.error.message).toContain('Failed to decode live notification against schema "user"');
      }
    });
  });
});
