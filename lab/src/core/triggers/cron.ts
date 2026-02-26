import { Effect, Schedule, Schema } from 'effect';
import { CronScheduler } from '~/services/cron';

import * as Base from './base';

export interface CronTriggerDef<I> extends Base.Trigger<I, never, CronScheduler> {
  readonly schema: <NewI>(newSchema: Schema.Schema<NewI, any, any>) => CronTriggerDef<NewI>;
}

export const cron = <I = void>(
  jobId: string,
  cronExpression: string,
  staticPayload?: I,
  payloadSchema: Schema.Schema<I, any, any> = (staticPayload === undefined
    ? Schema.Void
    : Schema.Any) as any,
): CronTriggerDef<I> => {
  const producer = Effect.gen(function*() {
    const scheduler = yield* CronScheduler;
    const queue = yield* Base.TriggerQueue; // Standard Effect Service Yield

    const input = yield* Schema.decodeUnknown(payloadSchema)(staticPayload).pipe(Effect.orDie);

    yield* Effect.repeat(
      Effect.gen(function*() {
        const claimed = yield* scheduler.claimJob(jobId, cronExpression);

        if (claimed) {
          yield* queue.offer(input);
        }
      }),
      Schedule.spaced('5 seconds'),
    ).pipe(Effect.forkScoped);
  });

  return {
    ...Base.make('Cron', { jobId, cronExpression }, payloadSchema, producer),
    schema: (newSchema) => cron(jobId, cronExpression, staticPayload as any, newSchema),
  };
};
