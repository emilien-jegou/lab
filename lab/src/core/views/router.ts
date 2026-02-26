import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Layer, Stream } from 'effect';
import { RouteRegistry } from '../system/router';
import { ViewRegistry } from './registry';

export const SystemViewRouterLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const routeRegistry = yield* RouteRegistry;
    const viewRegistry = yield* ViewRegistry;

    const getRouteParams = Effect.gen(function*() {
      const routeContextOpt = yield* Effect.serviceOption(HttpRouter.RouteContext);
      if (routeContextOpt._tag === 'Some') {
        return routeContextOpt.value.params;
      }
      const req = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(req.url, 'http://localhost');
      return Object.fromEntries(url.searchParams.entries());
    });

    const router = HttpRouter.empty.pipe(
      // 1. List all available views
      HttpRouter.get(
        '/__system/views',
        Effect.gen(function*() {
          const views = yield* viewRegistry.list();
          return yield* HttpServerResponse.json({
            views: views.map((v) => v.meta),
          });
        }),
      ),

      // 2. Get layout and metadata for a specific view
      HttpRouter.get(
        '/__system/views/:viewId',
        Effect.gen(function*() {
          const params = yield* getRouteParams;
          const viewId = params.viewId ?? '';

          const viewOpt = yield* viewRegistry.get(viewId);
          if (viewOpt._tag === 'None') {
            return yield* HttpServerResponse.json(
              { error: `View '${viewId}' not found` },
              { status: 404 },
            );
          }

          const v = viewOpt.value;
          return yield* HttpServerResponse.json({
            ...v.meta,
            layout: v.layout,
          });
        }),
      ),

      // 3. Query resolution endpoint (deferred server-side data)
      HttpRouter.get(
        '/__system/views/:viewId/query/:queryId',
        Effect.gen(function*() {
          const params = yield* getRouteParams;
          const viewId = params.viewId ?? '';
          const queryId = params.queryId ?? '';

          const viewOpt = yield* viewRegistry.get(viewId);
          if (viewOpt._tag === 'None') {
            return yield* HttpServerResponse.json(
              { error: `View '${viewId}' not found` },
              { status: 404 },
            );
          }

          const v = viewOpt.value;
          const query = v.queries.get(queryId);
          if (!query) {
            return yield* HttpServerResponse.json(
              { error: `Query '${queryId}' not found in view '${viewId}'` },
              { status: 404 },
            );
          }

          const data = yield* query.effect.pipe(
            Effect.provide(v.context),
            Effect.catchAllCause((cause) =>
              Effect.gen(function*() {
                yield* Effect.logError(`[View Query Failed] ${viewId}/${queryId}`, cause);
                return yield* Effect.fail(cause);
              }),
            ),
          );

          return yield* HttpServerResponse.json({
            queryId,
            data,
          });
        }),
      ),

      // 4. SSE stream endpoint
      HttpRouter.get(
        '/__system/views/:viewId/stream/:streamId',
        Effect.gen(function*() {
          const params = yield* getRouteParams;
          const viewId = params.viewId ?? '';
          const streamId = params.streamId ?? '';

          const viewOpt = yield* viewRegistry.get(viewId);
          if (viewOpt._tag === 'None') {
            return yield* HttpServerResponse.json(
              { error: `View '${viewId}' not found` },
              { status: 404 },
            );
          }

          const v = viewOpt.value;
          const streamRef = v.streams.get(streamId);
          if (!streamRef) {
            return yield* HttpServerResponse.json(
              { error: `Stream '${streamId}' not found in view '${viewId}'` },
              { status: 404 },
            );
          }

          const encoder = new TextEncoder();
          const sseStream = streamRef.stream.pipe(
            Stream.provideContext(v.context),
            Stream.map((payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)),
            Stream.catchAllCause((cause) =>
              Stream.make(
                encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ error: cause.toString() })}\n\n`,
                ),
              ),
            ),
          );

          return HttpServerResponse.stream(sseStream, {
            contentType: 'text/event-stream',
          }).pipe(
            HttpServerResponse.setHeader('cache-control', 'no-cache'),
            HttpServerResponse.setHeader('connection', 'keep-alive'),
          );
        }),
      ),

      // 5. Button action trigger endpoint
      HttpRouter.post(
        '/__system/views/:viewId/action/:actionId',
        Effect.gen(function*() {
          const params = yield* getRouteParams;
          const viewId = params.viewId ?? '';
          const actionId = params.actionId ?? '';

          const viewOpt = yield* viewRegistry.get(viewId);
          if (viewOpt._tag === 'None') {
            return yield* HttpServerResponse.json(
              { error: `View '${viewId}' not found` },
              { status: 404 },
            );
          }

          const v = viewOpt.value;
          const action = v.actions.get(actionId);
          if (!action) {
            return yield* HttpServerResponse.json(
              { error: `Action '${actionId}' not found in view '${viewId}'` },
              { status: 404 },
            );
          }

          const result = yield* action.handler.pipe(
            Effect.provide(v.context),
            Effect.catchAllCause((cause) =>
              Effect.gen(function*() {
                yield* Effect.logError(`[View Action Failed] ${viewId}/${actionId}`, cause);
                return yield* Effect.fail(cause);
              }),
            ),
          );

          const commands = Array.isArray(result)
            ? result
            : result && typeof result === 'object' && 'type' in result
              ? [result]
              : [];

          return yield* HttpServerResponse.json({
            success: true,
            actionId,
            commands,
          });
        }),
      ),
    );

    yield* Effect.forEach(router.routes, (route) => routeRegistry.register(route));
    yield* Effect.logInfo('[View] System View router mounted under /__system/views');
  }),
);
