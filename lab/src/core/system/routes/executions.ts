// System routes listing tracked executions and streaming execution events.
import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Stream } from 'effect';

import { ExecutionTracker, type ExecutionRecord } from '../tracker';

export const executionRoutes: HttpRouter.Route<any, any>[] = [
  HttpRouter.makeRoute('GET', '/__system/executions',
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

  HttpRouter.makeRoute('GET', '/__system/executions/subscribe',
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
];
