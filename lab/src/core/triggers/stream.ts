import { Effect, Schema, Stream, Schedule } from 'effect';

import * as Base from './base';

export interface StreamTriggerDef<I, E, R> extends Base.Trigger<I, E, R> {
  readonly schema: <NewI>(newSchema: Schema.Schema<NewI, any, any>) => StreamTriggerDef<NewI, E, R>;
}

export const stream = <I = unknown, E = never, R = never>(
  streamName: string,
  source: Stream.Stream<unknown, E, R>,
  payloadSchema: Schema.Schema<I, any, any> = Schema.Any as any,
): StreamTriggerDef<I, E, R> => {
  const producer = Effect.gen(function*() {
    const queue = yield* Base.TriggerQueue; // Yielded queue service

    yield* Stream.runForEach(source, (item) => queue.offer(item)).pipe(
      Effect.tapErrorCause((c) => Effect.logError(`[Stream Ingress] Crashed -> ${streamName}`, c)),
      Effect.retry(Schedule.spaced('1 second')),
    );
  });

  return {
    ...Base.make('Stream', { streamName }, payloadSchema, producer),
    schema: (newSchema) => stream(streamName, source, newSchema),
  };
};
