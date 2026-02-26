import { Effect, Context } from "effect"

export class CronScheduler extends Context.Tag("CronScheduler")<
  CronScheduler,
  {
    /**
     * Tries to atomically lock the job.
     * Returns true if the job is due and successfully locked by this worker.
     * Returns false if not due yet or locked by another worker.
     */
    readonly claimJob: (
      jobId: string,
      cronExpression: string
    ) => Effect.Effect<boolean, never, never>
  }
>() { }
