// System routes managing SSE subscriber connections and subscriptions.
import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Stream } from 'effect';

import { SseManager } from '../sse';

export const sseRoutes: HttpRouter.Route<any, any>[] = [
  // Unified SSE Channel
  HttpRouter.makeRoute('GET', '/__system/sse',
    Effect.gen(function*() {
      const sseManager = yield* SseManager;
      const { stream } = yield* sseManager.connect();

      const sseStream = stream.pipe(
        Stream.map((event) => `data: ${JSON.stringify(event)}\n\n`),
        Stream.encodeText,
      );

      return HttpServerResponse.stream(sseStream, {
        contentType: 'text/event-stream',
      }).pipe(
        HttpServerResponse.setHeader('Cache-Control', 'no-cache'),
        HttpServerResponse.setHeader('Connection', 'keep-alive'),
      );
    }),
  ),

  // HTTP Subscribe
  HttpRouter.makeRoute('POST', '/__system/sse/subscribe',
    Effect.gen(function*() {
      const sseManager = yield* SseManager;
      const request = yield* HttpServerRequest.HttpServerRequest;

      const body = (yield* request.json.pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      )) as { subscriberId?: string; eventType?: string } | null;

      if (!body?.subscriberId || !body?.eventType) {
        return yield* HttpServerResponse.json(
          { error: 'Fields "subscriberId" and "eventType" are required' },
          { status: 400 },
        );
      }

      return yield* sseManager.subscribe(body.subscriberId, body.eventType).pipe(
        Effect.flatMap((res) => HttpServerResponse.json(res, { status: 201 })),
        Effect.catchTag('SubscriberNotFound', () =>
          HttpServerResponse.json({ error: 'Subscriber not found' }, { status: 404 }),
        ),
      );
    }),
  ),

  // HTTP Unsubscribe (POST)
  HttpRouter.makeRoute('POST', '/__system/sse/unsubscribe',
    Effect.gen(function*() {
      const sseManager = yield* SseManager;
      const request = yield* HttpServerRequest.HttpServerRequest;

      const body = (yield* request.json.pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      )) as { subscriberId?: string; subscriptionId?: string } | null;

      if (!body?.subscriberId || !body?.subscriptionId) {
        return yield* HttpServerResponse.json(
          { error: 'Fields "subscriberId" and "subscriptionId" are required' },
          { status: 400 },
        );
      }

      return yield* sseManager.unsubscribe(body.subscriberId, body.subscriptionId).pipe(
        Effect.flatMap(() => HttpServerResponse.json({ ok: true })),
        Effect.catchTag('SubscriberNotFound', () =>
          HttpServerResponse.json({ error: 'Subscriber not found' }, { status: 404 }),
        ),
        Effect.catchTag('SubscriptionNotFound', () =>
          HttpServerResponse.json({ error: 'Subscription not found' }, { status: 404 }),
        ),
      );
    }),
  ),

  // HTTP Unsubscribe (REST DELETE alternative)
  HttpRouter.makeRoute('DELETE', '/__system/sse/subscriptions/:subscriptionId',
    Effect.gen(function*() {
      const sseManager = yield* SseManager;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, 'http://localhost');
      const subscriberId = url.searchParams.get('subscriberId');

      const parts = url.pathname.split('/');
      const subscriptionId = parts[parts.length - 1];

      if (!subscriberId || !subscriptionId) {
        return yield* HttpServerResponse.json(
          { error: 'Query param "subscriberId" and path param "subscriptionId" are required' },
          { status: 400 },
        );
      }

      return yield* sseManager.unsubscribe(subscriberId, subscriptionId).pipe(
        Effect.flatMap(() => HttpServerResponse.json({ ok: true })),
        Effect.catchTag('SubscriberNotFound', () =>
          HttpServerResponse.json({ error: 'Subscriber not found' }, { status: 404 }),
        ),
        Effect.catchTag('SubscriptionNotFound', () =>
          HttpServerResponse.json({ error: 'Subscription not found' }, { status: 404 }),
        ),
      );
    }),
  ),
];
