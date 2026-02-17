import { Schema, Context, Effect, Stream } from "effect"

export class MessageBroker extends Context.Tag("system/MessageBroker")<
  MessageBroker,
  {
    readonly publish: (topic: string, payload: unknown) => Effect.Effect<void>
    readonly subscribe: (topic: string) => Stream.Stream<unknown>
  }
>() { }

export const subscribeToBroker = (topic: string) =>
  Stream.unwrap(Effect.map(MessageBroker, b => b.subscribe(topic)))


// Define a helper type once in your broker file
export type BrokerPayload<T extends { publish: (payload: any) => any }> =
  Parameters<T["publish"]>[0]

export const defineBroker = <A, I, R>(topic: string, schema: Schema.Schema<A, I, R>) => {
  const decode = Schema.decodeUnknown(schema)
  const encode = Schema.encode(schema)

  return {
    publish: (payload: A) =>
      Effect.flatMap(MessageBroker, (broker) =>
        encode(payload).pipe(
          Effect.flatMap(encoded => broker.publish(topic, encoded)),
          Effect.orDie
        )
      ),

    subscribe: () =>
      Stream.unwrap(
        Effect.map(MessageBroker, (broker) =>
          broker.subscribe(topic).pipe(
            Stream.mapEffect(decode),
            Stream.catchAllCause(() => Stream.empty)
          )
        )
      )
  }
}
