// Valkey client connection service backed by ioredis.
import { Context, Effect, Layer, Option, Redacted } from 'effect';
import Redis, { type RedisOptions } from 'ioredis';

import { ValkeyConfig } from '../../config/valkey';
import { ValkeyCommandError, ValkeyConnectionError, type ValkeyError } from './errors';

export class Valkey extends Context.Tag('app/Valkey')<
  Valkey,
  {
    readonly client: Redis;

    /** Execute a raw Lua script with untyped return */
    readonly eval: <R = unknown>(
      script: string,
      keys: string[],
      args: (string | number)[]
    ) => Effect.Effect<R, ValkeyError>;
  }
>() { }

export const ValkeyLive = Layer.scoped(
  Valkey,
  Effect.gen(function*() {
    const config = yield* ValkeyConfig;

    const options: RedisOptions = {
      host: config.host,
      port: config.port,
      db: config.db,
      password: Option.isSome(config.password)
        ? Redacted.value(config.password.value)
        : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    };

    const client = new Redis(options);

    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => client.connect(),
        catch: (cause) =>
          new ValkeyConnectionError({
            message: `Failed to connect to Valkey at ${config.host}:${config.port}`,
            cause,
          }),
      }),
      () =>
        Effect.promise(async () => {
          try {
            await client.quit();
          } catch {
            client.disconnect();
          }
        })
    );

    const eval_ = <R = unknown>(
      script: string,
      keys: string[],
      args: (string | number)[]
    ): Effect.Effect<R, ValkeyError> =>
      Effect.tryPromise({
        try: () =>
          client.eval(script, keys.length, ...keys, ...args) as Promise<R>,
        catch: (cause) =>
          new ValkeyCommandError({
            command: `EVAL (${keys.length} keys)`,
            message: `Failed to execute Lua script in Valkey`,
            cause,
          }),
      });

    return { client, eval: eval_ };
  })
);
