// Framework logger that buffers log events and forwards them to Vector.
import { Context, Effect, Layer, Logger, HashMap, Queue, Console, Option, List } from 'effect';
import { VectorConfig } from '../../config/vector';

export interface LogEvent {
  readonly level: string;
  readonly message: string;
  readonly timestamp: number;
  readonly annotations: Record<string, unknown>;
  readonly trace_id?: string;
  readonly span_id?: string;
}

export class LogBuffer extends Context.Tag('system/LogBuffer')<
  LogBuffer,
  { readonly queue: Queue.Queue<LogEvent> }
>() { }

export const LogBufferLive = Layer.effect(LogBuffer, Effect.gen(function*() {
  const queue = yield* Queue.unbounded<LogEvent>();
  return LogBuffer.of({ queue });
}));

export const makeFrameworkLogger = (queue: Queue.Queue<LogEvent>): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message, annotations, date, spans }) => {
    const annos: Record<string, unknown> = {};
    HashMap.forEach(annotations, (value, key) => { annos[String(key)] = value; });

    if (annos.moduleId === "internal" || annos.triggerType === "Logger") {
      return;
    }

    const currentSpan = Option.getOrUndefined(List.head(spans)) as
      | { traceId?: string; spanId?: string }
      | undefined;

    queue.unsafeOffer({
      level: logLevel.label.toLowerCase(),
      message: Array.isArray(message) ? message.join(" ") : String(message),
      timestamp: date.getTime(),
      annotations: annos,
      ...(currentSpan?.traceId ? { trace_id: currentSpan.traceId } : {}),
      ...(currentSpan?.spanId ? { span_id: currentSpan.spanId } : {}),
    });
  });

export const FrameworkLoggerLive: Layer.Layer<never, never, LogBuffer> =
  Logger.addEffect(Effect.map(LogBuffer, (buf) => makeFrameworkLogger(buf.queue)));

export const VectorLogForwarderLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const config = yield* VectorConfig;
    const logBuffer = yield* LogBuffer;

    const flushLogs = Effect.gen(function*() {
      const first = yield* Queue.take(logBuffer.queue);
      const rest = yield* Queue.takeBetween(logBuffer.queue, 0, 99);
      const batch = [first, ...rest];

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
