import { Effect, Layer, Queue, Schedule, Stream } from 'effect';
import { MessageBroker } from '~/core/system';
import { VectorConfig } from '~/config/vector';

export interface VectorMessage {
  readonly topic: string;
  readonly payload: unknown;
  readonly timestamp?: number;
  readonly traceparent?: string; // W3C format: 00-<trace_id>-<span_id>-01
}

export const VectorBrokerLive = Layer.effect(
  MessageBroker,
  Effect.gen(function*() {
    const { ingestUrl } = yield* VectorConfig;

    // -------------------------------------------------------------------------
    // 1. Publisher Pipeline (HTTP Batching)
    // -------------------------------------------------------------------------
    const publishQueue = yield* Queue.unbounded<VectorMessage>();

    const publisherWorker = Effect.gen(function*() {
      while (true) {
        const items = yield* Queue.takeBetween(publishQueue, 1, 100);

        yield* Effect.tryPromise({
          try: () =>
            fetch(ingestUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(items),
            }),
          catch: (err) => new Error(`Vector Ingest Failed: ${err}`),
        }).pipe(
          Effect.retry(
            Schedule.exponential('200 millis').pipe(Schedule.intersect(Schedule.recurs(5))),
          ),
          Effect.catchAllCause((c) =>
            Effect.logError('[Vector Publisher] Dropped message batch', c),
          ),
        );
      }
    });

    yield* Effect.forkDaemon(publisherWorker);

    // -------------------------------------------------------------------------
    // 2. Multi-Subscriber Registry (Broadcasting to all topic streams)
    // -------------------------------------------------------------------------
    const subscribers = new Set<(msg: VectorMessage) => void>();

    const dispatch = (msg: VectorMessage) => {
      for (const listener of subscribers) {
        try {
          listener(msg);
        } catch {
          // Guard against listener defects
        }
      }
    };

    // Background daemon: Hosts WS server on 8687 for Vector to stream into
    const wsDaemon = Effect.gen(function*() {
      yield* Effect.sync(() => {
        Bun.serve({
          port: 8687,
          fetch(req, server) {
            if (server.upgrade(req)) return;
            return new Response('Upgrade failed', { status: 400 });
          },
          websocket: {
            open() {
              Effect.runFork(
                Effect.logInfo('[Vector Broker] Vector connected to internal stream'),
              );
            },
            message(_, message) {
              try {
                const raw = typeof message === 'string' ? message : message.toString();
                const parsed = JSON.parse(raw);

                if (Array.isArray(parsed)) {
                  for (const item of parsed) {
                    if (item && typeof item === 'object' && 'topic' in item) {
                      dispatch(item as VectorMessage);
                    }
                  }
                } else if (parsed && typeof parsed === 'object' && 'topic' in parsed) {
                  dispatch(parsed as VectorMessage);
                }
              } catch {
                // Ignore unparsable frames
              }
            },
            close() {
              Effect.runFork(
                Effect.logWarning('[Vector Broker] Vector disconnected from stream'),
              );
            },
          },
        });
      });
    });

    yield* Effect.forkDaemon(wsDaemon);

    return MessageBroker.of({
      publish: (topic, payload) =>
        Effect.gen(function*() {
          const timestamp = Date.now();

          // Capture current span if running inside an active trace
          const spanOpt = yield* Effect.currentSpan.pipe(Effect.option);
          const traceparent =
            spanOpt._tag === 'Some'
              ? `00-${spanOpt.value.traceId}-${spanOpt.value.spanId}-01`
              : undefined;

          const jsonPayload = JSON.parse(JSON.stringify(payload));
          const message: VectorMessage = {
            topic,
            payload: jsonPayload,
            timestamp,
            ...(traceparent ? { traceparent } : {}),
          };

          dispatch(message);
          yield* Queue.offer(publishQueue, message);
        }),

      subscribe: (targetTopic: string) =>
        Stream.async<unknown, never>((emit) => {
          const listener = (msg: VectorMessage) => {
            if (msg.topic === targetTopic) {
              // Attach _traceparent metadata if message carried a trace
              if (
                msg.traceparent &&
                typeof msg.payload === 'object' &&
                msg.payload !== null &&
                !Array.isArray(msg.payload)
              ) {
                emit.single({
                  ...(msg.payload as Record<string, unknown>),
                  _traceparent: msg.traceparent,
                });
              } else {
                emit.single(msg.payload);
              }
            }
          };

          subscribers.add(listener);

          return Effect.sync(() => {
            subscribers.delete(listener);
          });
        }),
    });
  }),
);
