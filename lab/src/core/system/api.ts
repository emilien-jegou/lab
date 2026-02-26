import { RecursionGuard } from "./recursion-guard";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Layer, JSONSchema, Stream, Redacted } from 'effect';

import { FrameworkConfig } from './config';
import { defineModule } from './module';
import { RouteRegistry } from './router';
import { SseManager } from './sse';
import {
  SystemExecutionBroker,
  ExecutionEventSchema,
  ExecutionTracker,
  type ExecutionRecord,
} from './tracker';
import { stream } from '../triggers/stream';
import { OpenObserveConfig } from '~/config/openobserve';

export const DbExecutionAggregatorLive = defineModule(
  'internal',
  stream('system:db-execution-aggregator', SystemExecutionBroker.subscribe())
    .schema(ExecutionEventSchema)
    .bind(() => Effect.void),
);

const SystemRouter = HttpRouter.empty.pipe(
  // lab/src/core/system/api.ts (inside SystemRouter)

  // GET /__system/quarantine -> list all blocked triggers
  HttpRouter.get(
    "/__system/quarantine",
    Effect.gen(function*() {
      const guard = yield* RecursionGuard;
      const blocked = yield* guard.getQuarantined;
      return yield* HttpServerResponse.json({ quarantined: blocked });
    })
  ),

  // POST /__system/quarantine/reset -> unblock an event type
  HttpRouter.post(
    "/__system/quarantine/reset",
    Effect.gen(function*() {
      const guard = yield* RecursionGuard;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = (yield* request.json.pipe(Effect.catchAll(() => Effect.succeed(null)))) as {
        key?: string;
      } | null;

      if (!body?.key) {
        return yield* HttpServerResponse.json(
          { error: 'Field "key" (e.g. "module:trigger") is required' },
          { status: 400 }
        );
      }

      yield* guard.reset(body.key);
      return yield* HttpServerResponse.json({ ok: true, unblocked: body.key });
    })
  ),

  HttpRouter.get(
    '/__system/conf',
    Effect.gen(function*() {
      const configSvc = yield* FrameworkConfig;
      const info = yield* configSvc.getInfo;

      const configuration = {
        modules: info.modules.map((mod) => ({
          ...mod,
          triggers: mod.triggers.map((trig) => ({
            ...trig,
            payloadSchema: JSONSchema.make(trig.payloadSchema),
          })),
        })),
      };

      return yield* HttpServerResponse.json({ configuration });
    }),
  ),

  HttpRouter.get(
    '/__system/executions',
    Effect.gen(function*() {
      const trackerOpt = yield* Effect.serviceOption(ExecutionTracker);
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, 'http://localhost');

      if (trackerOpt._tag === 'None') return yield* HttpServerResponse.json({ data: [] });

      const filters = {
        limit: parseInt(url.searchParams.get('limit') || '50', 10),
        offset: parseInt(url.searchParams.get('offset') || '0', 10),
        status: url.searchParams.get('status') || null,
        type: url.searchParams.get('type') || null,
        moduleId: url.searchParams.get('moduleId') || null,
      };

      const [executions, total] = yield* Effect.all(
        [
          trackerOpt.value.getExecutions(filters).pipe(
            Effect.catchAll(() => Effect.succeed([] as readonly ExecutionRecord[])),
          ),
          trackerOpt.value.countExecutions(filters).pipe(
            Effect.catchAll(() => Effect.succeed(0)),
          ),
        ],
        { concurrency: 2 },
      );

      return yield* HttpServerResponse.json({ data: executions, meta: { total, ...filters } });
    }),
  ),

  // Unified SSE Channel
  HttpRouter.get(
    '/__system/sse',
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
  HttpRouter.post(
    '/__system/sse/subscribe',
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
  HttpRouter.post(
    '/__system/sse/unsubscribe',
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
  HttpRouter.del(
    '/__system/sse/subscriptions/:subscriptionId',
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

  HttpRouter.get(
    '/__system/executions/subscribe',
    Effect.gen(function*() {
      const trackerOpt = yield* Effect.serviceOption(ExecutionTracker);
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, 'http://localhost');

      if (trackerOpt._tag === 'None') {
        return yield* HttpServerResponse.text('ExecutionTracker unavailable', { status: 503 });
      }

      const source = url.searchParams.get('source');
      const rawStream: Stream.Stream<unknown, unknown, never> =
        source === 'db'
          ? trackerOpt.value.subscribeExecutions()
          : trackerOpt.value.subscribeEvents();

      const sseStream = rawStream.pipe(
        Stream.map((event: unknown) => `data: ${JSON.stringify(event)}\n\n`),
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

  // lab/src/core/system/api.ts (inside SystemRouter GET /__system/logs)
  HttpRouter.get(
    '/__system/logs',
    Effect.gen(function*() {
      const config = yield* OpenObserveConfig;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, 'http://localhost');
      const basicAuth = btoa(`${config.username}:${Redacted.value(config.password)}`);

      const executionId = url.searchParams.get('executionId') || url.searchParams.get('runId');
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);

      // Query lab_logs, checking both lowercased and camelCased column names
      const querySql = executionId
        ? `SELECT * FROM "${config.logStream}" WHERE executionid='${executionId}' OR executionId='${executionId}' ORDER BY _timestamp DESC LIMIT ${limit}`
        : `SELECT * FROM "${config.logStream}" ORDER BY _timestamp DESC LIMIT ${limit}`;

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${config.url.replace(/\/+$/, "")}/api/${config.organization}/_search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${basicAuth}`,
            },
            body: JSON.stringify({
              query: { sql: querySql },
            }),
          }).then((r) => r.json()),
        catch: () => new Error('OpenObserve search failed'),
      }).pipe(Effect.catchAll(() => HttpServerResponse.json({ hits: [] })));

      return yield* HttpServerResponse.json(response);
    }),
  )
);

export const SystemRouterLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const registry = yield* RouteRegistry;
    yield* Effect.forEach(SystemRouter.routes, (route) => registry.register(route));
  }),
);
