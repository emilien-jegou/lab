// Typed key-value vault built on top of the Valkey client.
import { Duration, Effect, Option, Schema } from 'effect';

import { Valkey } from './client';
import {
  ValkeyCommandError,
  ValkeyDecodeError,
  ValkeyKeyNotFoundError,
  type ValkeyError,
} from './errors';

export interface SetOptions {
  /** Time-to-live: Duration, ms, or string like "10s", "15m", "1d" */
  readonly ttl?: Duration.DurationInput;
  /** Only set the key if it does not already exist */
  readonly ifNotExists?: boolean;
  /** Only set the key if it already exists */
  readonly ifExists?: boolean;
}

export interface ValkeyDefineOptions {
  /** Default TTL applied to `set` operations when no specific TTL is provided */
  readonly defaultTtl?: Duration.DurationInput;
}

export interface ValkeyKV<A> {
  readonly namespace: string;

  /** Retrieve and decode a value from the store. Returns Option.none() if missing. */
  readonly get: (key: string) => Effect.Effect<Option.Option<A>, ValkeyError>;

  /** Retrieve and decode a value, failing with ValkeyKeyNotFoundError if missing. */
  readonly getOrFail: (key: string) => Effect.Effect<A, ValkeyError>;

  /** Retrieve a value or return a fallback default if not found. */
  readonly getOrElse: (
    key: string,
    fallback: () => A | Effect.Effect<A, ValkeyError>
  ) => Effect.Effect<A, ValkeyError>;

  /** Encode and store a value with optional TTL. */
  readonly set: (key: string, value: A, options?: SetOptions) => Effect.Effect<void, ValkeyError>;

  /** Delete one or more keys in this vault. */
  readonly del: (...keys: string[]) => Effect.Effect<number, ValkeyError>;

  /** Check if a key exists in this vault. */
  readonly exists: (key: string) => Effect.Effect<boolean, ValkeyError>;

  /** Set TTL on an existing key. */
  readonly expire: (key: string, duration: Duration.DurationInput) => Effect.Effect<boolean, ValkeyError>;

  /** Get remaining TTL in seconds (-2 if missing, -1 if no TTL). */
  readonly ttl: (key: string) => Effect.Effect<number, ValkeyError>;

  /** Atomically read and update a value. */
  readonly update: (
    key: string,
    fn: (current: A) => A,
    options?: SetOptions
  ) => Effect.Effect<A, ValkeyError>;

  /** List all keys present in this namespace (keys are returned without the namespace prefix). */
  readonly keys: () => Effect.Effect<string[], ValkeyError>;

  /** Delete all keys stored in this namespace. */
  readonly clear: () => Effect.Effect<number, ValkeyError>;
}

export interface ValkeyKVDefinition<A, I>
  extends Effect.Effect<ValkeyKV<A>, never, Valkey> {
  readonly namespace: string;
  readonly schema: Schema.Schema<A, I, never>;
  readonly options?: ValkeyDefineOptions;
}

function makeValkeyKV<A, I>(
  namespace: string,
  schema: Schema.Schema<A, I, never>,
  valkey: Valkey["Type"],
  options?: ValkeyDefineOptions
): ValkeyKV<A> {
  const client = valkey.client;
  const toFullKey = (key: string) => `${namespace}:${key}`;
  const decodeUnknown = Schema.decodeUnknown(schema);
  const encode = Schema.encode(schema);

  const get = (key: string): Effect.Effect<Option.Option<A>, ValkeyError> =>
    Effect.gen(function*() {
      const fullKey = toFullKey(key);
      const raw = yield* Effect.tryPromise({
        try: () => client.get(fullKey),
        catch: (cause) =>
          new ValkeyCommandError({
            command: `GET ${fullKey}`,
            message: `Failed to GET key "${key}" in namespace "${namespace}"`,
            cause,
          }),
      });

      if (raw === null) return Option.none();

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (cause) {
        return yield* Effect.fail(
          new ValkeyDecodeError({
            key,
            namespace,
            message: `JSON parse error for key "${key}" in namespace "${namespace}"`,
            issue: cause,
          })
        );
      }

      const decoded = yield* decodeUnknown(parsed).pipe(
        Effect.mapError(
          (issue) =>
            new ValkeyDecodeError({
              key,
              namespace,
              message: `Schema decode error for key "${key}" in namespace "${namespace}": ${issue}`,
              issue,
            })
        )
      );

      return Option.some(decoded);
    });

  const getOrFail = (key: string): Effect.Effect<A, ValkeyError> =>
    Effect.gen(function*() {
      const opt = yield* get(key);
      if (Option.isNone(opt)) {
        return yield* Effect.fail(
          new ValkeyKeyNotFoundError({
            key,
            namespace,
            message: `Key "${key}" not found in namespace "${namespace}"`,
          })
        );
      }
      return opt.value;
    });

  const getOrElse = (
    key: string,
    fallback: () => A | Effect.Effect<A, ValkeyError>
  ): Effect.Effect<A, ValkeyError> =>
    Effect.gen(function*() {
      const opt = yield* get(key);
      if (Option.isSome(opt)) return opt.value;
      const res = fallback();
      return Effect.isEffect(res) ? yield* res : res;
    });

  const set = (
    key: string,
    value: A,
    opts?: SetOptions
  ): Effect.Effect<void, ValkeyError> =>
    Effect.gen(function*() {
      const fullKey = toFullKey(key);

      const encoded = yield* encode(value).pipe(
        Effect.mapError(
          (issue) =>
            new ValkeyDecodeError({
              key,
              namespace,
              message: `Schema encode error for key "${key}" in namespace "${namespace}"`,
              issue,
            })
        )
      );

      const stringValue = JSON.stringify(encoded);
      const args: (string | number)[] = [fullKey, stringValue];

      const effectiveTtl = opts?.ttl ?? options?.defaultTtl;
      if (effectiveTtl !== undefined) {
        const millis = Duration.toMillis(Duration.decode(effectiveTtl));
        args.push("PX", millis);
      }

      if (opts?.ifNotExists) {
        args.push("NX");
      } else if (opts?.ifExists) {
        args.push("XX");
      }

      yield* Effect.tryPromise({
        try: () => client.set(...(args as [string, string, ...any[]])),
        catch: (cause) =>
          new ValkeyCommandError({
            command: `SET ${fullKey}`,
            message: `Failed to SET key "${key}" in namespace "${namespace}"`,
            cause,
          }),
      });
    });

  const del = (...keys: string[]) =>
    Effect.gen(function*() {
      if (keys.length === 0) return 0;
      const fullKeys = keys.map(toFullKey);
      return yield* Effect.tryPromise({
        try: () => client.del(...fullKeys),
        catch: (cause) =>
          new ValkeyCommandError({
            command: `DEL ${fullKeys.join(" ")}`,
            message: `Failed to DEL keys in namespace "${namespace}"`,
            cause,
          }),
      });
    });

  const exists = (key: string) =>
    Effect.gen(function*() {
      const fullKey = toFullKey(key);
      const res = yield* Effect.tryPromise({
        try: () => client.exists(fullKey),
        catch: (cause) =>
          new ValkeyCommandError({
            command: `EXISTS ${fullKey}`,
            message: `Failed to check existence for key "${key}" in namespace "${namespace}"`,
            cause,
          }),
      });
      return res > 0;
    });

  const expire = (key: string, duration: Duration.DurationInput) =>
    Effect.gen(function*() {
      const fullKey = toFullKey(key);
      const millis = Duration.toMillis(Duration.decode(duration));
      const res = yield* Effect.tryPromise({
        try: () => client.pexpire(fullKey, millis),
        catch: (cause) =>
          new ValkeyCommandError({
            command: `PEXPIRE ${fullKey} ${millis}`,
            message: `Failed to set expiration for key "${key}" in namespace "${namespace}"`,
            cause,
          }),
      });
      return res === 1;
    });

  const ttl = (key: string) =>
    Effect.gen(function*() {
      const fullKey = toFullKey(key);
      return yield* Effect.tryPromise({
        try: () => client.ttl(fullKey),
        catch: (cause) =>
          new ValkeyCommandError({
            command: `TTL ${fullKey}`,
            message: `Failed to get TTL for key "${key}" in namespace "${namespace}"`,
            cause,
          }),
      });
    });

  const update = (
    key: string,
    fn: (current: A) => A,
    opts?: SetOptions
  ): Effect.Effect<A, ValkeyError> =>
    Effect.gen(function*() {
      const current = yield* getOrFail(key);
      const updated = fn(current);
      yield* set(key, updated, opts);
      return updated;
    });

  const keys = (): Effect.Effect<string[], ValkeyError> =>
    Effect.gen(function*() {
      const pattern = `${namespace}:*`;
      const prefixLen = namespace.length + 1;
      const matched = yield* Effect.tryPromise({
        try: async () => {
          let cursor = "0";
          const results: string[] = [];
          do {
            const [next, batch] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
            cursor = next;
            results.push(...batch);
          } while (cursor !== "0");
          return results;
        },
        catch: (cause) =>
          new ValkeyCommandError({
            command: `SCAN MATCH ${pattern}`,
            message: `Failed to scan keys for namespace "${namespace}"`,
            cause,
          }),
      });
      return matched.map((k) => k.slice(prefixLen));
    });

  const clear = (): Effect.Effect<number, ValkeyError> =>
    Effect.gen(function*() {
      const matched = yield* keys();
      if (matched.length === 0) return 0;
      return yield* del(...matched);
    });

  return {
    namespace,
    get,
    getOrFail,
    getOrElse,
    set,
    del,
    exists,
    expire,
    ttl,
    update,
    keys,
    clear,
  };
}

/**
 * Define a strongly typed key-value bucket.
 * The returned definition can be yielded directly inside `Effect.gen`.
 */
export function valkeyDefine<A, I>(
  namespace: string,
  schema: Schema.Schema<A, I, never>,
  options?: ValkeyDefineOptions
): ValkeyKVDefinition<A, I> {
  const effect = Effect.gen(function*() {
    const valkey = yield* Valkey;
    return makeValkeyKV(namespace, schema, valkey, options);
  });

  return Object.assign(effect, {
    namespace,
    schema,
    options,
  }) as ValkeyKVDefinition<A, I>;
}
