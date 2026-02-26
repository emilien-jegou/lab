import { Effect, Layer, Ref } from "effect"
import { CronScheduler } from "../definition"
import parser from "cron-parser"

export const CronSchedulerInMemory = Layer.effect(CronScheduler, Effect.gen(function*() {
  const state = yield* Ref.make(new Map<string, number>())

  return {
    claimJob: (jobId, cronExpression) => Effect.gen(function*() {
      const now = Date.now()
      const jobs = yield* Ref.get(state)
      const nextRunAt = jobs.get(jobId) ?? 0

      if (nextRunAt > now) {
        return false
      }

      const interval = parser.parse(cronExpression)
      const nextDate = interval.next().toDate().getTime()

      yield* Ref.update(state, (map) => new Map(map).set(jobId, nextDate))
      return true
    })
  }
}))

