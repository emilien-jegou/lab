import { Effect, Schedule, Ref, Schema } from 'effect';

import * as Base from './base';

export interface PollingTriggerDef<State, I, FetchE, FetchR> extends Base.Trigger<
  I,
  FetchE,
  FetchR
> {
  readonly schema: <NewI>(
    newSchema: Schema.Schema<NewI, any, any>,
  ) => PollingTriggerDef<State, NewI, FetchE, FetchR>;
}

export const polling = <State, I = unknown, FetchE = never, FetchR = never>(
  id: string,
  schedule: Schedule.Schedule<any, any, any>,
  initialState: State,
  fetcher: (state: State) => Effect.Effect<{ newState: State; items: I[] }, FetchE, FetchR>,
  payloadSchema: Schema.Schema<I, any, any> = Schema.Any as any,
): PollingTriggerDef<State, I, FetchE, FetchR> => {
  const producer = Effect.gen(function*() {
    const queue = yield* Base.TriggerQueue;
    const stateRef = yield* Ref.make(initialState);

    yield* Effect.repeat(
      Effect.gen(function*() {
        const state = yield* Ref.get(stateRef);
        const { newState, items } = yield* fetcher(state);

        for (const item of items) {
          yield* queue.offer(item);
        }

        yield* Ref.set(stateRef, newState);
      }),
      schedule,
    ).pipe(Effect.forkScoped);
  });

  return {
    ...Base.make('Polling', { id }, payloadSchema, producer),
    // Re-added `as any` so TypeScript infers `I` purely from the newSchema type
    schema: (newSchema) => polling(id, schedule, initialState, fetcher as any, newSchema),
  };
};
