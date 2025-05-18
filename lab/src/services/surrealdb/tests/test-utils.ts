// lab/src/services/surrealdb/tests/test-utils.ts
import * as Effect from 'effect/Effect';
import type * as Stream from 'effect/Stream';
import { vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import type { LiveNotification } from '../api';
import { SurrealEngine } from '../engine';
import { StatementBuilder } from '../statement-builder';

export type MockLiveSubscriber = (
  sql: string,
  bindings: Record<string, unknown>,
  onNotification: (notification: LiveNotification<any>) => void,
) => () => Promise<void> | void;

export const createMockEngine = (
  mockData: unknown = [],
  liveSubscribe?: MockLiveSubscriber,
) => {
  return SurrealEngine.of({
    query: <T>() => Effect.succeed(mockData as T),
    queryRaw: () => Effect.succeed(Array.isArray(mockData) ? mockData : [mockData]),
    live: liveSubscribe
      ? <T>(
          sql: string,
          bindings: Record<string, unknown>,
          onNotification: (n: LiveNotification<T>) => void,
        ) => Effect.succeed(liveSubscribe(sql, bindings, onNotification))
      : undefined,
  });
};

export const mockEngine = createMockEngine([]);

export const useAstCapture = () => {
  let spy: MockInstance;

  beforeEach(() => {
    spy = vi.spyOn(StatementBuilder.prototype, 'compile');
  });

  afterEach(() => {
    spy.mockRestore();
  });

  const capture = <T>(
    query:
      | Iterable<any>
      | Effect.Effect<any, any, never>
      | Stream.Stream<any, any, any>
      | { getAst: () => any }
      | unknown,
  ): T => {
    // Fast path: extract AST directly if builder or stream carries getAst()
    if (
      query &&
      typeof query === 'object' &&
      'getAst' in query &&
      typeof (query as any).getAst === 'function'
    ) {
      return (query as any).getAst() as T;
    }

    // Fallback: execute Effect safely
    Effect.runSyncExit(
      query && typeof query === 'object' && 'toEffect' in query
        ? (query as any).toEffect()
        : (query as any),
    );
    const calls = spy.mock.calls;
    return calls[calls.length - 1]?.[0] as T;
  };

  return {
    capture,
    get spy() {
      return spy;
    },
  };
};
