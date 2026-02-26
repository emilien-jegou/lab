import { Schema, Stream, Effect } from "effect"
import * as Base from "./base"
import { MessageBroker } from "../system/broker"
import type { LogEvent } from "../system/logger" // Add "type" if it's purely a type

const LogEventSchema = Schema.Struct({
  level: Schema.String,
  message: Schema.String,
  timestamp: Schema.Date,
  annotations: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

export const logger = (): Base.Trigger<LogEvent, never, MessageBroker> => {
  const producer = Effect.gen(function*() {
    const broker = yield* MessageBroker
    const queue = yield* Base.TriggerQueue // Yielded queue service

    const stream = broker.subscribe("system:logs")
    yield* Stream.runForEach(stream, (raw) => queue.offer(raw))
  })

  return Base.make(
    "Logger",
    { topic: "system:logs" },
    LogEventSchema as any,
    producer
  )
}
