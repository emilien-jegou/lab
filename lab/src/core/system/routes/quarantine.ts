// System routes for circuit-breaker quarantine management.
import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { RecursionGuard } from '../recursion-guard';

export const quarantineRoutes: HttpRouter.Route<any, any>[] = [
  // GET /__system/quarantine -> list all blocked triggers
  HttpRouter.makeRoute('GET', "/__system/quarantine",
    Effect.gen(function*() {
      const guard = yield* RecursionGuard;
      const blocked = yield* guard.getQuarantined;
      return yield* HttpServerResponse.json({ quarantined: blocked });
    })
  ),

  // POST /__system/quarantine/reset -> unblock an event type
  HttpRouter.makeRoute('POST', "/__system/quarantine/reset",
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
];
