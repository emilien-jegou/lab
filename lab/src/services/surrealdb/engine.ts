import { Data, Redacted } from 'effect';
import type { ParseResult } from 'effect';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Surreal } from 'surrealdb';

import { SurrealConfig } from '~/config/surrealdb';
import type { LiveNotification } from './api';

// ============================================================================
// TAGGED ERRORS
// ============================================================================

export class SurrealConnectionError extends Data.TaggedError('SurrealConnectionError')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class SurrealQueryError extends Data.TaggedError('SurrealQueryError')<{
  readonly sql: string;
  readonly bindings: Record<string, unknown>;
  readonly cause: unknown;
  readonly message: string;
}> {}

export class SurrealDecodeError extends Data.TaggedError('SurrealDecodeError')<{
  readonly issue: ParseResult.ParseError | ParseResult.ParseIssue;
  readonly message: string;
}> {}

export class SurrealRecordNotFoundError extends Data.TaggedError('SurrealRecordNotFoundError')<{
  readonly target: unknown;
  readonly message: string;
}> {}

export type SurrealError =
  | SurrealConnectionError
  | SurrealQueryError
  | SurrealDecodeError
  | SurrealRecordNotFoundError;

// ============================================================================
// RESPONSE UNWRAPPING & NORMALIZATION HELPERS
// ============================================================================

export function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object') {
    if ('tb' in val && 'id' in val) {
      return typeof (val as any).id === 'string' || typeof (val as any).id === 'number'
        ? String((val as any).id)
        : String(val);
    }
    if (val.constructor?.name === 'RecordId' || (val as any)._tag === 'RecordId') {
      return 'id' in (val as any) ? String((val as any).id) : String(val);
    }
  }
  if (Array.isArray(val)) {
    return val.map(normalizeValue);
  }
  if (typeof val === 'object' && !(val instanceof Date)) {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = normalizeValue(v);
    }
    return res;
  }
  return val;
}

export function unwrapSurrealResult<T>(response: unknown): T {
  if (!Array.isArray(response)) {
    return response as T;
  }
  if (response.length === 0) {
    return response as T;
  }
  const first = response[0];
  if (first && typeof first === 'object') {
    if ('status' in first && (first as any).status === 'ERR') {
      const errorMsg =
        (first as any).detail || (first as any).result || 'SurrealDB query execution error';
      throw new Error(String(errorMsg));
    }
    if ('error' in first && (first as any).error) {
      const err = (first as any).error;
      const errorMsg = typeof err === 'object' && 'message' in err ? err.message : String(err);
      throw new Error(String(errorMsg));
    }
    if ('status' in first && 'result' in first) {
      return (first as any).result as T;
    }
  }
  if (response.length === 1) {
    if (first && typeof first === 'object' && 'id' in first && !Array.isArray(first)) {
      return response as T;
    }
    return first as T;
  }
  return response as T;
}

export function unwrapSurrealTransactionResults(
  response: unknown,
  expectedCount: number,
): unknown[] {
  if (!Array.isArray(response)) {
    return [];
  }
  for (const item of response) {
    if (item && typeof item === 'object') {
      if ('status' in item && (item as any).status === 'ERR') {
        const errorMsg =
          (item as any).detail || (item as any).result || 'SurrealDB Transaction Error';
        throw new Error(String(errorMsg));
      }
      if ('error' in item && (item as any).error) {
        const err = (item as any).error;
        const errorMsg = typeof err === 'object' && 'message' in err ? err.message : String(err);
        throw new Error(String(errorMsg));
      }
    }
  }
  const unwrapItem = (item: any) =>
    item && typeof item === 'object' && 'status' in item && 'result' in item ? item.result : item;

  if (response.length >= expectedCount + 2) {
    return response.slice(1, expectedCount + 1).map(unwrapItem);
  }
  return response.map(unwrapItem);
}

// ============================================================================
// ENGINE SERVICE
// ============================================================================

export interface SurrealEngine {
  readonly query: <T>(
    sql: string,
    bindings: Record<string, unknown>,
  ) => Effect.Effect<T, SurrealQueryError, never>;
  readonly queryRaw?: (
    sql: string,
    bindings: Record<string, unknown>,
  ) => Effect.Effect<unknown[], SurrealQueryError, never>;
  readonly live?: <T>(
    sql: string,
    bindings: Record<string, unknown>,
    onNotification: (notification: LiveNotification<T>) => void,
  ) => Effect.Effect<() => Promise<void> | void, SurrealQueryError, never>;
}

export const SurrealEngine = Context.GenericTag<SurrealEngine>('SurrealEngine');

export const SurrealLive = Layer.scoped(
  SurrealEngine,
  Effect.gen(function* (_) {
    const config = yield* _(SurrealConfig);
    const db = new Surreal();

    const wsUrl = config.url.startsWith('ws')
      ? config.url
      : config.url
          .replace(/^http:\/\//, 'ws://')
          .replace(/^https:\/\//, 'wss://')
          .replace(/\/+$/, '') + '/rpc';

    // Resolve credentials as token or RootAuth object
    const authentication =
      config.token._tag === 'Some'
        ? config.token.value
        : {
            username:
              config.username._tag === 'Some'
                ? config.username.value
                : process.env.SURREAL_USER ||
                  process.env.SURREAL_USERNAME ||
                  process.env.SURREALDB_USER ||
                  'root',
            password:
              config.password._tag === 'Some'
                ? Redacted.value(config.password.value)
                : process.env.SURREAL_PASS ||
                  process.env.SURREAL_PASSWORD ||
                  process.env.SURREALDB_PASS ||
                  'root',
          };

    yield* Effect.tryPromise({
      try: async () => {
        // Connect with full session options so the SDK natively auto-reconnects and restores authentication
        const connectOptions = {
          namespace: config.namespace,
          database: config.database,
          authentication,
          reconnect: {
            enabled: true,
            attempts: -1, // Infinite reconnect attempts on drop
            retryDelay: 1000,
          },
        };

        try {
          await db.connect(wsUrl, connectOptions);
        } catch {
          await db.connect(config.url, connectOptions);
        }
      },
      catch: (cause) =>
        new SurrealConnectionError({
          cause,
          message: `SurrealDB Connection Error: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    yield* Effect.addFinalizer(() =>
      Effect.promise(() => db.close()).pipe(Effect.catchAll(() => Effect.void)),
    );

    return SurrealEngine.of({
      query: <T>(sql: string, bindings: Record<string, unknown>) =>
        Effect.tryPromise({
          try: async () => {
            const response = await db.query(sql, bindings);
            return unwrapSurrealResult<T>(response);
          },
          catch: (cause) =>
            new SurrealQueryError({
              sql,
              bindings,
              cause,
              message: `SurrealDB Query Error: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        }),

      queryRaw: (sql: string, bindings: Record<string, unknown>) =>
        Effect.tryPromise({
          try: async () => {
            const response = await db.query(sql, bindings);
            return Array.isArray(response) ? response : [response];
          },
          catch: (cause) =>
            new SurrealQueryError({
              sql,
              bindings,
              cause,
              message: `SurrealDB Query Error: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        }),

      live: <T>(
        sql: string,
        bindings: Record<string, unknown>,
        onNotification: (notification: LiveNotification<T>) => void,
      ) =>
        Effect.tryPromise({
          try: async () => {
            const response = await db.query(sql, bindings);
            const uuid = unwrapSurrealResult<string>(response);

            if (typeof (db as any).subscribeLive === 'function') {
              await (db as any).subscribeLive(uuid, (action: any) => {
                onNotification({
                  action: (action.action ?? action.type ?? 'UPDATE').toUpperCase() as any,
                  result: normalizeValue(action.result) as any,
                  queryId: String(uuid),
                });
              });
            }

            return async () => {
              try {
                if (typeof (db as any).kill === 'function') {
                  await (db as any).kill(uuid);
                } else {
                  await db.query(`KILL $uuid;`, { uuid });
                }
              } catch {
                // Ignore unsubscribe/kill errors on shutdown
              }
            };
          },
          catch: (cause) =>
            new SurrealQueryError({
              sql,
              bindings,
              cause,
              message: `SurrealDB Live Query Error: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        }),
    });
  }),
);
