import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

// Import the route from the flow
import { BaserowAgentRoute } from "../flows/baserow-updater"

const Router = HttpRouter.fromIterable([
  BaserowAgentRoute
])

const App = Router.pipe(
  Effect.catchAllCause((cause) =>
    HttpServerResponse.json(
      { error: "Internal Server Error", details: cause.toString() },
      { status: 500 }
    )
  ),
  Effect.withSpan("http.server") // Wrap the entire app in a span
)

export const ServerLayer = HttpServer.serve(App).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)
