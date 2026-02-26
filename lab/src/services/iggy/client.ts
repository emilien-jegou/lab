// lab/src/services/iggy/client.ts
import { Context, Effect, Layer, Redacted, Ref, SynchronizedRef } from "effect";
import { IggyConfig } from "~/config/iggy";

interface IggyLoginResponse {
  readonly tokens?: {
    readonly access_token?: {
      readonly token?: string;
    };
  };
  readonly access_token?:
    | {
        readonly token?: string;
      }
    | string;
}

interface IggyResourceDetails {
  readonly id: number;
  readonly name: string;
}

interface IggyPollMessage {
  readonly offset: number;
  readonly timestamp: number;
  readonly id: number | string;
  readonly payload: string;
}

interface IggyPollResponse {
  readonly messages?: readonly IggyPollMessage[];
}

interface TopicContext {
  readonly streamIdNum: number;
  readonly topicIdNum: number;
}

export class IggyClient extends Context.Tag("services/IggyClient")<
  IggyClient,
  {
    readonly publish: (topic: string, payload: unknown) => Effect.Effect<void>;
    readonly poll: (topic: string, consumerId: number, count?: number) => Effect.Effect<readonly unknown[]>;
  }
>() {}

const sanitizeId = (name?: string): string => {
  if (!name || typeof name !== "string") return "";
  return name.replace(/[:\/]/g, "_").toLowerCase().trim();
};

export const IggyClientLive = Layer.effect(
  IggyClient,
  Effect.gen(function* () {
    const config = yield* IggyConfig;
    const tokenRef = yield* Ref.make<string | null>(null);
    const resolvedStreamId = yield* SynchronizedRef.make<number | null>(null);
    const resolvedTopics = yield* SynchronizedRef.make<Map<string, TopicContext>>(new Map());

    const rawStream = sanitizeId(config.streamId);
    const streamName = rawStream.length > 0 ? rawStream : "lab";

    // 1. Authentication helper
    const getHeaders = Effect.gen(function* () {
      let token = yield* Ref.get(tokenRef);
      if (!token) {
        const loginRes = yield* Effect.tryPromise(() =>
          fetch(`${config.url}/users/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: config.username,
              password: Redacted.value(config.password),
            }),
          }).then((r) => (r.ok ? (r.json() as Promise<IggyLoginResponse>) : null))
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));

        const extractedToken =
          loginRes?.tokens?.access_token?.token ??
          (typeof loginRes?.access_token === "object"
            ? loginRes?.access_token?.token
            : loginRes?.access_token) ??
          null;

        if (extractedToken) {
          token = extractedToken;
          yield* Ref.set(tokenRef, token);
        }
      }
      return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
    });

    // 2. Resolve or create Stream and return its numeric ID atomically
    const ensureStreamId = SynchronizedRef.modifyEffect(
      resolvedStreamId,
      (currentId) =>
        Effect.gen(function* () {
          if (currentId !== null) {
            return [currentId, currentId] as const;
          }

          const headers = yield* getHeaders;

          // Check if stream already exists
          const existing = yield* Effect.tryPromise(() =>
            fetch(`${config.url}/streams/${streamName}`, { headers }).then((r) =>
              r.ok ? (r.json() as Promise<IggyResourceDetails>) : null
            )
          ).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (existing?.id !== undefined && existing?.id !== null) {
            return [existing.id, existing.id] as const;
          }

          // Create stream
          yield* Effect.tryPromise(async () => {
            const res = await fetch(`${config.url}/streams`, {
              method: "POST",
              headers,
              body: JSON.stringify({ name: streamName }),
            });
            if (res.ok || res.status === 409) return;
            const errText = await res.text().catch(() => "");
            if (errText.includes("already exists") || errText.includes("already_exists")) return;
            throw new Error(`Failed to create stream '${streamName}': ${res.status} ${errText}`);
          });

          // Fetch numeric ID of created stream
          const created = yield* Effect.tryPromise(() =>
            fetch(`${config.url}/streams/${streamName}`, { headers }).then((r) =>
              r.ok ? (r.json() as Promise<IggyResourceDetails>) : null
            )
          ).pipe(Effect.catchAll(() => Effect.succeed(null)));

          const id = created?.id ?? 0;
          return [id, id] as const;
        })
    );

    // 3. Resolve or create Topic and return numeric Stream ID + Topic ID atomically
    const ensureTopicContext = (rawTopic: string) => {
      const sanitized = sanitizeId(rawTopic);
      const topicName = sanitized.length > 0 ? sanitized : "default";

      return SynchronizedRef.modifyEffect(resolvedTopics, (map) =>
        Effect.gen(function* () {
          const cached = map.get(topicName);
          if (cached) {
            return [cached, map] as const;
          }

          const streamIdNum = yield* ensureStreamId;
          const headers = yield* getHeaders;

          // Check if topic exists
          const existing = yield* Effect.tryPromise(() =>
            fetch(`${config.url}/streams/${streamIdNum}/topics/${topicName}`, { headers }).then((r) =>
              r.ok ? (r.json() as Promise<IggyResourceDetails>) : null
            )
          ).pipe(Effect.catchAll(() => Effect.succeed(null)));

          let topicIdNum = existing?.id;

          if (topicIdNum === undefined || topicIdNum === null) {
            yield* Effect.tryPromise(async () => {
              const res = await fetch(`${config.url}/streams/${streamIdNum}/topics`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  name: topicName,
                  partitions_count: 1,
                  compression_algorithm: "none",
                  message_expiry: 604800,
                  max_topic_size: 0,
                }),
              });
              if (res.ok || res.status === 409) return;
              const errText = await res.text().catch(() => "");
              if (errText.includes("already exists") || errText.includes("already_exists")) return;
              throw new Error(`Failed to create topic '${topicName}': ${res.status} ${errText}`);
            });

            const created = yield* Effect.tryPromise(() =>
              fetch(`${config.url}/streams/${streamIdNum}/topics/${topicName}`, { headers }).then((r) =>
                r.ok ? (r.json() as Promise<IggyResourceDetails>) : null
              )
            ).pipe(Effect.catchAll(() => Effect.succeed(null)));

            topicIdNum = created?.id ?? 0;
          }

          const ctx: TopicContext = { streamIdNum, topicIdNum };
          const nextMap = new Map(map);
          nextMap.set(topicName, ctx);

          return [ctx, nextMap] as const;
        })
      );
    };

    return IggyClient.of({
      publish: (rawTopic, payload) =>
        Effect.gen(function* () {
          const { streamIdNum, topicIdNum } = yield* ensureTopicContext(rawTopic);
          const headers = yield* getHeaders;

          const serialized = JSON.stringify(payload);
          const base64Payload = Buffer.from(serialized).toString("base64");

          // Target partition 0 explicitly (4 bytes LE = "AAAAAA==")
          const body = JSON.stringify({
            partitioning: {
              kind: "partition_id",
              length: 4,
              value: "AAAAAA==",
            },
            messages: [
              {
                id: 0,
                payload: base64Payload,
              },
            ],
          });

          yield* Effect.tryPromise(async () => {
            const res = await fetch(
              `${config.url}/streams/${streamIdNum}/topics/${topicIdNum}/messages`,
              { method: "POST", headers, body }
            );
            if (!res.ok) {
              const err = await res.text().catch(() => "");
              throw new Error(`Iggy HTTP ${res.status}: ${err}`);
            }
          });
        }).pipe(
          Effect.catchAllCause((c) =>
            Effect.logError(`[IggyClient] Failed to publish on topic '${rawTopic}'`, c)
          )
        ),

      poll: (rawTopic, consumerId, count = 10) =>
        Effect.gen(function* () {
          const { streamIdNum, topicIdNum } = yield* ensureTopicContext(rawTopic);
          const headers = yield* getHeaders;

          // Target numeric stream + topic and partition 0
          const url = `${config.url}/streams/${streamIdNum}/topics/${topicIdNum}/messages?consumer_id=${consumerId}&partition_id=0&kind=next&count=${count}&auto_commit=true`;

          const rawData = yield* Effect.tryPromise(async () => {
            const res = await fetch(url, { headers });
            if (!res.ok) return null;
            return (await res.json()) as IggyPollResponse;
          }).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (!rawData || !Array.isArray(rawData.messages)) {
            return [] as readonly unknown[];
          }

          const parsed: unknown[] = [];
          for (const msg of rawData.messages) {
            try {
              const jsonStr = Buffer.from(msg.payload, "base64").toString("utf-8");
              parsed.push(JSON.parse(jsonStr));
            } catch {
              // Ignore unparsable items
            }
          }
          return parsed as readonly unknown[];
        }).pipe(
          Effect.catchAllCause(() => Effect.succeed([] as readonly unknown[]))
        ),
    });
  })
);
