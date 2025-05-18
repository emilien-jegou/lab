import { Effect, Layer, Ref } from "effect"
import { CronScheduler } from "../definition"
import { sql, id } from "../../surrealdb/api-builder"
import { SurrealEngine } from "../../surrealdb/engine"
import parser from "cron-parser"

export const CronSchedulerSurrealLive = Layer.effect(
  CronScheduler,
  Effect.gen(function*() {
    const engine = yield* SurrealEngine

    // In-memory cache of already-registered schedules for this process.
    // Prevents redundant `INSERT ... ON DUPLICATE` writes to disk on every tick.
    const registeredSchedules = yield* Ref.make(new Map<string, string>())

    // 1. Initialize table & index once at startup (gracefully ignored if already created or restricted)
    yield* sql`
      DEFINE TABLE IF NOT EXISTS system_cron_jobs SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_cron_next_run ON TABLE system_cron_jobs COLUMNS next_run_at;
    `.pipe(
      Effect.provideService(SurrealEngine, engine),
      Effect.ignore
    )

    return {
      claimJob: (jobId, cronExpression) =>
        Effect.gen(function*() {
          const jobRecord = id("system_cron_jobs", jobId)
          const schedules = yield* Ref.get(registeredSchedules)
          const currentSchedule = schedules.get(jobId)

          // 2. Ensure the record exists in SurrealDB only on startup or when the schedule string changes.
          // This eliminates disk write amplification on idle ticks while remaining safe across replicas.
          if (currentSchedule !== cronExpression) {
            yield* sql`
              INSERT INTO system_cron_jobs (id, schedule, next_run_at)
              VALUES (${jobRecord}, ${cronExpression}, time::now())
              ON DUPLICATE KEY UPDATE schedule = ${cronExpression};
            `
            yield* Ref.update(registeredSchedules, (map) =>
              new Map(map).set(jobId, cronExpression)
            )
          }

          // 3. Compute the next run date according to the cron schedule
          const interval = parser.parse(cronExpression)
          const nextRunDate = interval.next().toDate()

          // 4. ATOMIC CLAIM:
          // Uses SurrealDB's row-level lock and server-side `time::now()`.
          // If two workers hit this concurrently, only the first to acquire the lock
          // sees `next_run_at <= time::now()` as TRUE and updates the record.
          // The second worker sees `next_run_at` in the future and updates 0 rows.
          const result = yield* sql<{ id: unknown }>`
            UPDATE ${jobRecord}
            SET
              next_run_at = ${nextRunDate},
              last_run_at = time::now()
            WHERE next_run_at <= time::now()
            RETURN id;
          `

          return result.length > 0
        }).pipe(
          Effect.provideService(SurrealEngine, engine),
          // 5. SAFETY & FAULT TOLERANCE:
          // If a transient network glitch or DB connection drop occurs, log a warning
          // and return false so the worker can retry on the next tick without crashing the fiber.
          Effect.catchAll((err) =>
            Effect.logWarning(`Cron claim check failed for job '${jobId}': ${err}`).pipe(
              Effect.as(false)
            )
          )
        )
    }
  })
)

export const CronSchedulerSurreal = CronSchedulerSurrealLive
