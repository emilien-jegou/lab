// lab/src/core/system/broker.ts
import { Schema, Context, Effect, Stream, Layer } from 'effect';
import { IggyClient } from '~/services/iggy/client';

export class MessageBroker extends Context.Tag('system/MessageBroker')<
  MessageBroker,
  {
    readonly publish: (topic: string, payload: unknown) => Effect.Effect<void>;
    readonly subscribe: (topic: string) => Stream.Stream<unknown>;
  }
>() {}

export const MessageBrokerLive = Layer.effect(
  MessageBroker,
  Effect.gen(function*() {
    const iggy = yield* IggyClient;

    return MessageBroker.of({
      publish: (topic, payload) => iggy.publish(topic, payload),

      subscribe: (topic) => {
        const consumerId = Math.floor(Math.random() * 2147483647);

        return Stream.repeatEffect(
          iggy.poll(topic, consumerId, 20).pipe(Effect.delay('50 millis'))
        ).pipe(
          Stream.flatMap((messages) => Stream.fromIterable(messages))
        );
      },
    });
  })
);

export const subscribeToBroker = (topic: string) =>
  Stream.unwrap(Effect.map(MessageBroker, (b) => b.subscribe(topic)));

/** A typed handle over a single broker topic. */
export interface BrokerTopic<A, R = never> {
  /** Topic name this handle publishes to and subscribes from. */
  readonly topic: string;
  /** Encodes and publishes a payload to the topic. */
  readonly publish: (payload: A) => Effect.Effect<void, never, MessageBroker | R>;
  /** Subscribes to decoded payloads from the topic. */
  readonly subscribe: () => Stream.Stream<A, never, MessageBroker | R>;
}

/** The payload type accepted by a broker topic's `publish`. */
export type BrokerPayload<T extends BrokerTopic<any, any>> = Parameters<T['publish']>[0];

export const defineBroker = <A, I, R>(
  topic: string,
  schema: Schema.Schema<A, I, R>,
): BrokerTopic<A, R> => {
  const decode = Schema.decodeUnknown(schema);
  const encode = Schema.encode(schema);

  return {
    topic,
    publish: (payload: A) =>
      Effect.flatMap(MessageBroker, (broker) =>
        encode(payload).pipe(
          Effect.flatMap((encoded) => broker.publish(topic, encoded)),
          Effect.orDie,
        ),
      ),

    subscribe: () =>
      Stream.unwrap(
        Effect.map(MessageBroker, (broker) =>
          broker.subscribe(topic).pipe(
            Stream.mapEffect(decode),
            Stream.catchAllCause(() => Stream.empty),
          ),
        ),
      ),
  };
};
