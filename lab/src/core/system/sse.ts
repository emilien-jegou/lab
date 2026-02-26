import { Context, Data, Effect, Fiber, Layer, Queue, Ref, Stream } from 'effect';
import { MessageBroker } from './broker';

export class SubscriberNotFoundError extends Data.TaggedError('SubscriberNotFound')<{
  readonly subscriberId: string;
}> {}

export class SubscriptionNotFoundError extends Data.TaggedError('SubscriptionNotFound')<{
  readonly subscriptionId: string;
}> {}

export interface SseConnectedEvent {
  readonly type: 'connected';
  readonly subscriberId: string;
}

export interface SseDataEvent {
  readonly subscriptionId: string;
  readonly eventType: string;
  readonly data: unknown;
}

export type SseMessage = SseConnectedEvent | SseDataEvent;

interface ActiveSubscription {
  readonly id: string;
  readonly eventType: string;
  readonly fiber: Fiber.RuntimeFiber<unknown, unknown>;
}

interface ActiveSubscriber {
  readonly id: string;
  readonly queue: Queue.Queue<SseMessage>;
  readonly subscriptions: Map<string, ActiveSubscription>;
}

export class SseManager extends Context.Tag('system/SseManager')<
  SseManager,
  {
    readonly connect: () => Effect.Effect<{
      readonly subscriberId: string;
      readonly stream: Stream.Stream<SseMessage>;
    }>;
    readonly subscribe: (
      subscriberId: string,
      eventType: string,
    ) => Effect.Effect<{ readonly subscriptionId: string }, SubscriberNotFoundError>;
    readonly unsubscribe: (
      subscriberId: string,
      subscriptionId: string,
    ) => Effect.Effect<void, SubscriberNotFoundError | SubscriptionNotFoundError>;
  }
>() {}

export const SseManagerLive = Layer.effect(
  SseManager,
  Effect.gen(function*() {
    const broker = yield* MessageBroker;
    const subscribersRef = yield* Ref.make<Map<string, ActiveSubscriber>>(new Map());

    const removeSubscriber = (subscriberId: string) =>
      Effect.gen(function*() {
        const subscriber = yield* Ref.modify(subscribersRef, (map) => {
          const sub = map.get(subscriberId);
          if (!sub) return [undefined, map] as const;
          const next = new Map(map);
          next.delete(subscriberId);
          return [sub, next] as const;
        });

        if (subscriber) {
          yield* Effect.forEach(
            Array.from(subscriber.subscriptions.values()),
            (sub) => Fiber.interrupt(sub.fiber),
            { discard: true },
          );
          subscriber.subscriptions.clear();
          yield* Queue.shutdown(subscriber.queue);
        }
      });

    const resolveStream = (eventType: string): Stream.Stream<unknown, never, never> => {
      if (eventType.startsWith('view:')) {
        const [, viewId, streamId] = eventType.split(':');
        const port = process.env.PORT || '3000';
        return Stream.unwrap(
          Effect.gen(function*() {
            const res = yield* Effect.tryPromise({
              try: () =>
                fetch(`http://127.0.0.1:${port}/__system/views/${viewId}/stream/${streamId}`, {
                  headers: { Accept: 'text/event-stream' },
                }),
              catch: () => new Error(`Failed to bridge view stream ${eventType}`),
            });

            if (!res.ok || !res.body) return Stream.empty;

            return Stream.fromReadableStream(
              () => res.body!,
              () => new Error('View stream disconnected'),
            ).pipe(
              Stream.decodeText('utf-8'),
              Stream.splitLines,
              Stream.filter((l) => l.startsWith('data:')),
              Stream.map((l) => {
                const raw = l.replace(/^data:\s*/, '').trim();
                try {
                  return JSON.parse(raw);
                } catch {
                  return raw;
                }
              }),
            );
          }).pipe(Effect.catchAll(() => Effect.succeed(Stream.empty))),
        ).pipe(Stream.catchAll(() => Stream.empty));
      }

      return broker.subscribe(eventType).pipe(Stream.catchAll(() => Stream.empty));
    };

    return SseManager.of({
      connect: () =>
        Effect.gen(function*() {
          const subscriberId = crypto.randomUUID();
          const queue = yield* Queue.unbounded<SseMessage>();

          const subscriber: ActiveSubscriber = {
            id: subscriberId,
            queue,
            subscriptions: new Map(),
          };

          yield* Ref.update(subscribersRef, (map) => new Map(map).set(subscriberId, subscriber));

          yield* Queue.offer(queue, {
            type: 'connected',
            subscriberId,
          });

          const stream = Stream.fromQueue(queue).pipe(
            Stream.ensuring(removeSubscriber(subscriberId)),
          );

          return { subscriberId, stream };
        }),

      subscribe: (subscriberId, eventType) =>
        Effect.gen(function*() {
          const subscribers = yield* Ref.get(subscribersRef);
          const subscriber = subscribers.get(subscriberId);
          if (!subscriber) {
            return yield* Effect.fail(new SubscriberNotFoundError({ subscriberId }));
          }

          const subscriptionId = crypto.randomUUID();
          const rawStream = resolveStream(eventType);

          const fiber = yield* rawStream.pipe(
            Stream.runForEach((data) =>
              Queue.offer(subscriber.queue, {
                subscriptionId,
                eventType,
                data,
              }),
            ),
            Effect.forkDaemon,
          );

          subscriber.subscriptions.set(subscriptionId, {
            id: subscriptionId,
            eventType,
            fiber,
          });

          return { subscriptionId };
        }),

      unsubscribe: (subscriberId, subscriptionId) =>
        Effect.gen(function*() {
          const subscribers = yield* Ref.get(subscribersRef);
          const subscriber = subscribers.get(subscriberId);
          if (!subscriber) {
            return yield* Effect.fail(new SubscriberNotFoundError({ subscriberId }));
          }

          const sub = subscriber.subscriptions.get(subscriptionId);
          if (!sub) {
            return yield* Effect.fail(new SubscriptionNotFoundError({ subscriptionId }));
          }

          subscriber.subscriptions.delete(subscriptionId);
          yield* Fiber.interrupt(sub.fiber);
        }),
    });
  }),
);
