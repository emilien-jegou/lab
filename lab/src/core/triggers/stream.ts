import { Effect, Schema, Stream, Schedule, Queue } from "effect"
import { Trigger } from "./base"

export class StreamTrigger<I, E, R> extends Trigger<I, E, R> {
  readonly _tag = "Stream"

  constructor(
    readonly streamName: string,
    readonly source: Stream.Stream<unknown, E, R>,
    readonly payloadSchema: Schema.Schema<I, any, any> = Schema.Any as any
  ) {
    super()
  }

  get meta() {
    return { streamName: this.streamName }
  }

  schema<NewI>(newSchema: Schema.Schema<NewI, any, any>): StreamTrigger<NewI, E, R> {
    return new StreamTrigger(this.streamName, this.source, newSchema)
  }

  protected load(queue: Queue.Queue<unknown>) {
    return Stream.runForEach(this.source, (item) => queue.offer(item)).pipe(
      Effect.tapErrorCause(c => Effect.logError(`[Stream Ingress] Crashed -> ${this.streamName}`, c)),
      Effect.retry(Schedule.spaced("1 second"))
    )
  }
}

export const stream = <I, E, R>(
  streamName: string,
  source: Stream.Stream<unknown, E, R>,
  schema?: Schema.Schema<I, any, any>
) => new StreamTrigger(streamName, source, schema)
