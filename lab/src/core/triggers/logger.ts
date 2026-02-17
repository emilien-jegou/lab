import { Schema, Stream, Queue, Effect } from "effect"
import { Trigger } from "./base"
import { MessageBroker } from "../system/broker"
import { type LogEvent } from "../system/logger"

const LogEventSchema = Schema.Struct({
  level: Schema.String,
  message: Schema.String,
  timestamp: Schema.Date,
  annotations: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

export class LoggerTrigger extends Trigger<LogEvent, never, MessageBroker> {
  readonly _tag = "Logger"
  readonly meta = { topic: "system:logs" }
  readonly payloadSchema = LogEventSchema as any

  protected load(queue: Queue.Queue<unknown>) {
    return Effect.gen(function*() {
      const broker = yield* MessageBroker
      const stream = broker.subscribe("system:logs")
      yield* Stream.runForEach(stream, (raw) => queue.offer(raw))
    })
  }
}

export const logger = () => new LoggerTrigger();
