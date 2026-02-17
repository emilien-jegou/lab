import { Effect, Schedule, Ref, Schema, Queue } from "effect"
import { Trigger } from "./base"

export class PollingTrigger<State, I, FetchE, FetchR> extends Trigger<I, FetchE, FetchR> {
  readonly _tag = "Polling"

  constructor(
    readonly id: string,
    readonly schedule: Schedule.Schedule<any, any, any>,
    readonly initialState: State,
    readonly fetcher: (state: State) => Effect.Effect<{ newState: State; items: I[] }, FetchE, FetchR>,
    readonly payloadSchema: Schema.Schema<I, any, any> = Schema.Any as any
  ) {
    super()
  }

  get meta() {
    return { id: this.id }
  }

  schema<NewI>(newSchema: Schema.Schema<NewI, any, any>): PollingTrigger<State, NewI, FetchE, FetchR> {
    return new PollingTrigger(this.id, this.schedule, this.initialState, this.fetcher as any, newSchema)
  }

  protected load(queue: Queue.Queue<unknown>) {
    return Effect.gen(this, function*() {
      const stateRef = yield* Ref.make(this.initialState)

      yield* Effect.repeat(Effect.gen(this, function*() {
        const state = yield* Ref.get(stateRef)
        const { newState, items } = yield* this.fetcher(state)

        for (const item of items) {
          yield* queue.offer(item)
        }

        yield* Ref.set(stateRef, newState)
      }), this.schedule).pipe(
        Effect.forkScoped
      )
    })
  }
}

export const polling = <State, I, FetchE, FetchR>(
  id: string,
  schedule: Schedule.Schedule<any, any, any>,
  initialState: State,
  fetcher: (state: State) => Effect.Effect<{ newState: State; items: I[] }, FetchE, FetchR>
) => new PollingTrigger(id, schedule, initialState, fetcher)
