// System route exposing the registered module and trigger configuration.
import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { Effect, JSONSchema } from 'effect';

import { FrameworkConfig } from '../config';

export const configRoutes: HttpRouter.Route<any, any>[] = [
  HttpRouter.makeRoute('GET', '/__system/conf',
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
];
