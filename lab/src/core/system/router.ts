import {
  HttpRouter,
  HttpApp,
  HttpServerRequest,
  HttpServerResponse,
  HttpServer,
} from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import { Context, Effect, Layer, Ref } from 'effect';

export class RouteRegistry extends Context.Tag('system/RouteRegistry')<
  RouteRegistry,
  {
    readonly register: (route: HttpRouter.Route<any, any>) => Effect.Effect<void>;
    readonly app: HttpApp.Default<any, HttpServerRequest.HttpServerRequest>;
  }
>() { }

export const RouteRegistryLive = Layer.effect(
  RouteRegistry,
  Effect.gen(function*() {
    const routerRef = yield* Ref.make<HttpRouter.HttpRouter<any, any>>(HttpRouter.empty);

    return {
      register: (route) => Ref.update(routerRef, (router) => HttpRouter.append(router, route)),
      app: Effect.gen(function*() {
        const router = yield* Ref.get(routerRef);
        return yield* (router as HttpRouter.HttpRouter<any, any>).pipe(
          Effect.catchTag('RouteNotFound' as any, () =>
            HttpServerResponse.text('Not Found', { status: 404 }),
          ),
        );
      }).pipe(
        Effect.catchAllCause((cause) =>
          HttpServerResponse.json(
            { error: 'Internal Error', details: cause.toString() },
            { status: 500 },
          ),
        ),
      ),
    };
  }),
);

export const ServerLive = Layer.scopedDiscard(
  Effect.gen(function*() {
    const registry = yield* RouteRegistry;

    // Annotate the built-in HTTP span created by @effect/platform
    const appWithMiddleware = registry.app.pipe(
      Effect.flatMap((res) =>
        Effect.gen(function*() {
          const req = yield* HttpServerRequest.HttpServerRequest;
          yield* Effect.annotateCurrentSpan({
            "http.status_code": res.status,
            "http.method": req.method,
            "http.url": req.url,
          });
          return res;
        })
      )
    );

    yield* Effect.forkScoped(
      HttpServer.serve(appWithMiddleware).pipe(
        Layer.provide(BunHttpServer.layer({ port: 3000 })),
        Layer.launch,
      ),
    );
  }),
);
