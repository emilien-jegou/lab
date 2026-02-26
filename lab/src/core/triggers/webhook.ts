// lab/src/core/triggers/webhook.ts
import { HttpRouter, HttpMethod, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Schema, Match } from 'effect';

import { RouteRegistry } from '../system/router';

import * as Base from './base';

type ParserType = 'json' | 'form' | 'multipart' | 'text';

interface WebhookConfig<I> {
  readonly path: HttpRouter.PathInput;
  readonly method: HttpMethod.HttpMethod;
  readonly parser: ParserType;
  readonly schema: Schema.Schema<I, any, any>;
}

export interface WebhookTriggerDef<I> extends Base.Trigger<I, never, RouteRegistry> {
  readonly json: <NewI>(schema: Schema.Schema<NewI, any, any>) => WebhookTriggerDef<NewI>;
  readonly form: <NewI>(schema: Schema.Schema<NewI, any, any>) => WebhookTriggerDef<NewI>;
  readonly multipart: <NewI>(schema: Schema.Schema<NewI, any, any>) => WebhookTriggerDef<NewI>;
}

const makeWebhookTrigger = <I>(config: WebhookConfig<I>): WebhookTriggerDef<I> => {
  const producer = Effect.gen(function*() {
    const registry = yield* RouteRegistry;
    const queue = yield* Base.TriggerQueue;

    const parseBody = Match.value(config.parser).pipe(
      Match.when('json', () => HttpServerRequest.schemaBodyJson(config.schema)),
      Match.when('form', () => HttpServerRequest.schemaBodyUrlParams(config.schema)),
      Match.when('multipart', () => HttpServerRequest.schemaBodyMultipart(config.schema)),
      Match.when('text', () => Effect.map(HttpServerRequest.HttpServerRequest, (r) => r.text)),
      Match.exhaustive,
    );

    const route = HttpRouter.makeRoute(
      config.method,
      config.path,
      Effect.gen(function*() {
        const body = yield* parseBody;

        // Capture the incoming HTTP request span
        const spanOpt = yield* Effect.currentSpan.pipe(Effect.option);
        const traceparent =
          spanOpt._tag === 'Some'
            ? `00-${spanOpt.value.traceId}-${spanOpt.value.spanId}-01`
            : undefined;

        // Forward traceparent to worker without breaking non-object payloads
        const payloadWithTrace =
          traceparent && typeof body === 'object' && body !== null && !Array.isArray(body)
            ? { ...(body as Record<string, unknown>), _traceparent: traceparent }
            : body;

        yield* queue.offer(payloadWithTrace);

        return yield* HttpServerResponse.json({ status: 'accepted' }, { status: 202 });
      }),
    );

    yield* registry.register(route);
    yield* Effect.logInfo(`[Webhook] Mounted ${config.method} ${config.path}`);
  });

  return {
    ...Base.make(
      'Webhook',
      {
        path: String(config.path),
        method: config.method,
        parser: config.parser,
      },
      config.schema,
      producer,
    ),

    json: (schema) => makeWebhookTrigger({ ...config, parser: 'json', schema }),
    form: (schema) => makeWebhookTrigger({ ...config, parser: 'form', schema }),
    multipart: (schema) => makeWebhookTrigger({ ...config, parser: 'multipart', schema }),
  };
};

export const webhook = {
  post: (path: HttpRouter.PathInput) =>
    makeWebhookTrigger({ path, method: 'POST', parser: 'json', schema: Schema.Any }),
  get: (path: HttpRouter.PathInput) =>
    makeWebhookTrigger({ path, method: 'GET', parser: 'text', schema: Schema.Any }),
  make: (path: HttpRouter.PathInput) =>
    makeWebhookTrigger({ path, method: 'POST', parser: 'json', schema: Schema.Any }),
};
