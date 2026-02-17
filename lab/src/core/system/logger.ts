import { Effect, Layer, Logger, HashMap, Queue, Console } from "effect"
import { logger } from "../triggers/logger"
import { MessageBroker } from "./broker"

export interface LogEvent {
  readonly level: string;
  readonly message: string;
  readonly timestamp: Date;
  readonly annotations: Record<string, unknown>;
}

const logBuffer = Effect.runSync(Queue.unbounded<LogEvent>())

export const FrameworkLogger = Logger.make(({ logLevel, message, annotations, date }) => {
  const messageStr = Array.isArray(message) ? message.join(" ") : String(message)
  const annos: Record<string, unknown> = {}
  HashMap.forEach(annotations, (value, key) => { annos[String(key)] = value })

  logBuffer.unsafeOffer({
    level: logLevel.label,
    message: messageStr,
    timestamp: date,
    annotations: annos
  })
})

export const LogIngressLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const broker = yield* MessageBroker

    const worker = Effect.gen(function*() {
      while (true) {
        const event = yield* Queue.take(logBuffer)
        yield* broker.publish("system:logs", event).pipe(
          Effect.catchAllCause((c) =>
            Effect.sync(() => Console.error("[LogIngress] Broker publish failed", c))
          )
        )
      }
    })

    yield* Effect.forkDaemon(worker)
  })
)

export const LokiLogAggregatorLive = logger().bindAsLayer((evt) =>
  Effect.gen(function*() {
    const lokiUrl = process.env.LOKI_URL || "http://localhost:3100"
    yield* Effect.tryPromise({
      try: () => fetch(`${lokiUrl}/loki/api/v1/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streams: [{
            stream: { app: "lab", level: evt.level.toLowerCase() },
            values: [[(evt.timestamp.getTime() * 1000000).toString(), evt.message]]
          }]
        })
      }),
      catch: () => new Error("Loki Push Failed")
    })
  }).pipe(
    Effect.catchAllCause((c) => Effect.logError("Loki push failed", c))
  )
)
