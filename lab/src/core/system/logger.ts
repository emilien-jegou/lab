// lab/src/core/system/logger.ts
import { Effect, Layer, Logger, HashMap, Queue, Console, Option, List } from "effect";
import { VectorConfig } from "../../config/vector";

export interface LogEvent {
  readonly level: string;
  readonly message: string;
  readonly timestamp: number;
  readonly annotations: Record<string, unknown>;
  readonly trace_id?: string;
  readonly span_id?: string;
}

const logBuffer = Effect.runSync(Queue.unbounded<LogEvent>());

export const FrameworkLogger = Logger.make(({ logLevel, message, annotations, date, spans }) => {
  const annos: Record<string, unknown> = {};
  HashMap.forEach(annotations, (value, key) => { annos[String(key)] = value; });

  if (annos.moduleId === "internal" || annos.triggerType === "Logger") {
    return;
  }

  const currentSpan = Option.getOrUndefined(List.head(spans)) as
    | { traceId?: string; spanId?: string }
    | undefined;

  logBuffer.unsafeOffer({
    level: logLevel.label.toLowerCase(),
    message: Array.isArray(message) ? message.join(" ") : String(message),
    timestamp: date.getTime(),
    annotations: annos,
    ...(currentSpan?.traceId ? { trace_id: currentSpan.traceId } : {}),
    ...(currentSpan?.spanId ? { span_id: currentSpan.spanId } : {}),
  });
});

export const VectorLogForwarderLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const config = yield* VectorConfig;

    const flushLogs = Effect.gen(function*() {
      const first = yield* Queue.take(logBuffer);
      const rest = yield* Queue.takeBetween(logBuffer, 0, 99);
      const batch = [first, ...rest];

      // Format as NDJSON (Newline Delimited JSON) for Vector HTTP source
      const ndjsonBody = batch.map((evt) => JSON.stringify(evt)).join("\n");

      yield* Effect.tryPromise(async () => {
        const res = await fetch(config.ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-ndjson" },
          body: ndjsonBody,
        });
        if (!res.ok) {
          throw new Error(`Vector returned HTTP ${res.status}`);
        }
      }).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => Console.error("[VectorLogForwarder] Flush failed:", err.message))
        )
      );
    });

    yield* Effect.forkDaemon(Effect.forever(flushLogs));
  })
);
