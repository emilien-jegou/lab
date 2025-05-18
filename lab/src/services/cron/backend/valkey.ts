import { Effect, Layer } from "effect";
import parser from "cron-parser";
import { CronScheduler } from "../definition";
import { Valkey } from "../../valkey";

const HARDENED_CLAIM_LUA = `
  local key = KEYS[1]
  local cron_expr = ARGV[1]
  local next_run_str = ARGV[2]
  local next_run = tonumber(next_run_str)

  -- 1. Use Valkey server's own clock as the SINGLE SOURCE OF TRUTH
  local time_res = redis.call('TIME')
  local now = (tonumber(time_res[1]) * 1000) + math.floor(tonumber(time_res[2]) / 1000)

  local current_next_run = redis.call('HGET', key, 'next_run_at')

  -- 2. Atomic claim if:
  --    a) Job was never registered before (current_next_run is nil)
  --    b) Job is due (current_next_run <= now)
  if not current_next_run or tonumber(current_next_run) <= now then
    redis.call('HMSET', key,
      'schedule', cron_expr,
      'next_run_at', next_run,
      'last_run_at', now
    )
    return 1
  else
    -- 3. If schedule definition changed in code, update it without modifying next_run_at
    local current_schedule = redis.call('HGET', key, 'schedule')
    if current_schedule ~= cron_expr then
      redis.call('HSET', key, 'schedule', cron_expr)
    end
    return 0
  end
`;

export const CronSchedulerValkeyLive = Layer.effect(
  CronScheduler,
  Effect.gen(function* () {
    const valkey = yield* Valkey;

    return {
      claimJob: (jobId, cronExpression) =>
        Effect.gen(function* () {
          const interval = parser.parse(cronExpression);
          const nextRunAt = interval.next().toDate().getTime();
          const key = `system:cron:${jobId}`;

          const result = yield* valkey.eval<number>(
            HARDENED_CLAIM_LUA,
            [key],
            [cronExpression, nextRunAt]
          );

          return result === 1;
        }).pipe(
          // Safety: Don't let transient Valkey disconnects crash the cron fiber
          Effect.catchAll((err) =>
            Effect.logWarning(
              `Valkey cron claim failed for job '${jobId}': ${err}`
            ).pipe(Effect.as(false))
          )
        ),
    };
  })
);
