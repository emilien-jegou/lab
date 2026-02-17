import { Effect, Schedule, Schema, Queue } from "effect"
import { Trigger } from "./base"
import { CronScheduler } from "~/services/cron"

export class CronTrigger<I> extends Trigger<I, never, CronScheduler> {
  readonly _tag = "Cron"

  constructor(
    readonly jobId: string,
    readonly cronExpression: string,
    readonly payloadSchema: Schema.Schema<I, any, any>,
    readonly staticPayload?: I
  ) {
    super()
  }

  get meta() {
    return { jobId: this.jobId, cronExpression: this.cronExpression }
  }

  schema<NewI>(newSchema: Schema.Schema<NewI, any, any>): CronTrigger<NewI> {
    return new CronTrigger(this.jobId, this.cronExpression, newSchema, this.staticPayload as any)
  }

  protected load(queue: Queue.Queue<unknown>) {
    return Effect.gen(this, function*() {
      const scheduler = yield* CronScheduler

      const input = yield* Schema.decodeUnknown(this.payloadSchema)(this.staticPayload).pipe(
        Effect.orDie
      )

      yield* Effect.repeat(Effect.gen(this, function*() {
        const claimed = yield* scheduler.claimJob(this.jobId, this.cronExpression)

        if (claimed) {
          yield* queue.offer(input)
        }
      }), Schedule.spaced("5 seconds")).pipe(
        Effect.forkScoped
      )
    })
  }
}

export const cron = <I = void>(
  jobId: string,
  cronExpression: string,
  staticPayload?: I,
  payloadSchema: Schema.Schema<I, any, any> = (staticPayload === undefined ? Schema.Void : Schema.Any) as any
) => new CronTrigger(jobId, cronExpression, payloadSchema, staticPayload)
