// System route proxying log searches to OpenObserve.
import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Redacted } from 'effect';

import { OpenObserveConfig } from '~/config/openobserve';

export const logRoutes: HttpRouter.Route<any, any>[] = [
  HttpRouter.makeRoute('GET', '/__system/logs',
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
  ),
];
