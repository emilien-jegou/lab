import { Context, Data, Effect, Layer, Ref } from "effect";

export class InfiniteRecursionError extends Data.TaggedError("InfiniteRecursionError")<{
  readonly key: string;
  readonly reason: string;
  readonly timestamp: number;
}> {}

interface RateTracker {
  count: number;
  windowStart: number;
}

interface QuarantineRecord {
  readonly key: string;
  readonly reason: string;
  readonly trippedAt: number;
}

export interface RecursionGuardConfig {
  readonly maxDepth: number;          // e.g. 15 hops in a causal chain
  readonly maxVelocity: number;       // e.g. 50 tasks in 1 second
  readonly velocityWindowMs: number;  // sliding window in ms (1000ms)
}

export class RecursionGuard extends Context.Tag("system/RecursionGuard")<
  RecursionGuard,
  {
    readonly checkAndRecord: (
      key: string,
      currentDepth?: number
    ) => Effect.Effect<void, InfiniteRecursionError>;
    readonly isQuarantined: (key: string) => Effect.Effect<boolean>;
    readonly getQuarantined: Effect.Effect<readonly QuarantineRecord[]>;
    readonly reset: (key: string) => Effect.Effect<void>;
  }
>() {}

export const RecursionGuardLive = (
  config: RecursionGuardConfig = { maxDepth: 15, maxVelocity: 50, velocityWindowMs: 1000 }
) =>
  Layer.effect(
    RecursionGuard,
    Effect.gen(function* () {
      const quarantined = yield* Ref.make<Map<string, QuarantineRecord>>(new Map());
      const rates = yield* Ref.make<Map<string, RateTracker>>(new Map());

      const tripCircuit = (key: string, reason: string) =>
        Effect.gen(function* () {
          const record: QuarantineRecord = {
            key,
            reason,
            trippedAt: Date.now(),
          };
          yield* Ref.update(quarantined, (map) => new Map(map).set(key, record));
          console.error(
            `\n🚨 [CIRCUIT BREAKER TRIPPED] Event/Trigger '${key}' QUARANTINED! Reason: ${reason}\n`
          );
          yield* Effect.logError(`[CircuitBreaker] Event '${key}' quarantined: ${reason}`);
          return yield* Effect.fail(
            new InfiniteRecursionError({
              key,
              reason,
              timestamp: record.trippedAt,
            })
          );
        });

      return RecursionGuard.of({
        checkAndRecord: (key: string, currentDepth = 0) =>
          Effect.gen(function* () {
            // 1. Check if already quarantined
            const qMap = yield* Ref.get(quarantined);
            if (qMap.has(key)) {
              const q = qMap.get(key)!;
              return yield* Effect.fail(
                new InfiniteRecursionError({
                  key,
                  reason: `Quarantined since ${new Date(q.trippedAt).toISOString()}: ${q.reason}`,
                  timestamp: q.trippedAt,
                })
              );
            }

            // 2. Check causal depth
            if (currentDepth > config.maxDepth) {
              return yield* tripCircuit(
                key,
                `Exceeded max recursion depth of ${config.maxDepth} (current: ${currentDepth})`
              );
            }

            // 3. Velocity tracking (sliding window)
            const now = Date.now();
            const shouldTrip = yield* Ref.modify(rates, (rateMap) => {
              const current = rateMap.get(key) ?? { count: 0, windowStart: now };
              const nextMap = new Map(rateMap);

              if (now - current.windowStart > config.velocityWindowMs) {
                // Window expired, reset window
                nextMap.set(key, { count: 1, windowStart: now });
                return [false, nextMap] as const;
              }

              const newCount = current.count + 1;
              nextMap.set(key, { count: newCount, windowStart: current.windowStart });

              if (newCount > config.maxVelocity) {
                return [true, nextMap] as const;
              }

              return [false, nextMap] as const;
            });

            if (shouldTrip) {
              return yield* tripCircuit(
                key,
                `Velocity limit exceeded: > ${config.maxVelocity} executions in ${config.velocityWindowMs}ms`
              );
            }
          }),

        isQuarantined: (key: string) =>
          Effect.map(Ref.get(quarantined), (map) => map.has(key)),

        getQuarantined: Effect.map(Ref.get(quarantined), (map) =>
          Array.from(map.values())
        ),

        reset: (key: string) =>
          Effect.gen(function* () {
            yield* Ref.update(quarantined, (map) => {
              const next = new Map(map);
              next.delete(key);
              return next;
            });
            yield* Ref.update(rates, (map) => {
              const next = new Map(map);
              next.delete(key);
              return next;
            });
            yield* Effect.logInfo(`[CircuitBreaker] Event '${key}' manually unblocked`);
          }),
      });
    })
  );
