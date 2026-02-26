import { CronScheduler } from "../definition"
import { Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import parser from "cron-parser"

export const CronSchedulerPostgres = Layer.effect(CronScheduler, Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS system_cron_jobs (
      job_id VARCHAR(255) PRIMARY KEY,
      schedule VARCHAR(255) NOT NULL,
      next_run_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      last_run_at TIMESTAMP WITH TIME ZONE
    )
  `.pipe(Effect.orDie)

  return {
    claimJob: (jobId, cronExpression) => Effect.gen(function*() {
      const interval = parser.parse(cronExpression)
      const nextRunDate = interval.next().toDate()

      yield* sql`
        INSERT INTO system_cron_jobs (job_id, schedule, next_run_at)
        VALUES (${jobId}, ${cronExpression}, NOW()) 
        ON CONFLICT (job_id) DO UPDATE 
        SET schedule = ${cronExpression}
      `.pipe(Effect.orDie)

      const result = yield* sql`
        WITH claimed_job AS (
          SELECT job_id
          FROM system_cron_jobs
          WHERE job_id = ${jobId}
            AND next_run_at <= NOW()
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE system_cron_jobs
        SET 
          next_run_at = ${nextRunDate},
          last_run_at = NOW()
        FROM claimed_job
        WHERE system_cron_jobs.job_id = claimed_job.job_id
        RETURNING system_cron_jobs.job_id
      `.pipe(Effect.orDie)

      return result.length > 0
    })
  }
}))
