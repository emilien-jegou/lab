import { HttpRouter, HttpMethod, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Schema, Queue, Match } from "effect"
import { Trigger } from "./base"
import { RouteRegistry } from "../system/router"

type ParserType = "json" | "form" | "multipart" | "text"

interface WebhookConfig<I> {
  readonly path: HttpRouter.PathInput
  readonly method: HttpMethod.HttpMethod
  readonly parser: ParserType
  readonly schema: Schema.Schema<I, any, any>
}

export class WebhookTrigger<I> extends Trigger<I, never, RouteRegistry> {
  readonly _tag = "Webhook"

  constructor(private readonly config: WebhookConfig<I>) {
    super()
  }

  get meta() {
    return {
      path: String(this.config.path),
      method: this.config.method,
      parser: this.config.parser
    }
  }

  get payloadSchema() {
    return this.config.schema
  }

  json<NewI>(schema: Schema.Schema<NewI, any, any>) {
    return new WebhookTrigger<NewI>({ ...this.config, parser: "json", schema })
  }

  form<NewI>(schema: Schema.Schema<NewI, any, any>) {
    return new WebhookTrigger<NewI>({ ...this.config, parser: "form", schema })
  }

  multipart<NewI>(schema: Schema.Schema<NewI, any, any>) {
    return new WebhookTrigger<NewI>({ ...this.config, parser: "multipart", schema })
  }

  protected load(queue: Queue.Queue<unknown>) {
    return Effect.gen(this, function*() {
      const registry = yield* RouteRegistry
      const { config } = this

      const parseBody = Match.value(config.parser).pipe(
        Match.when("json", () => HttpServerRequest.schemaBodyJson(config.schema)),
        Match.when("form", () => HttpServerRequest.schemaBodyUrlParams(config.schema)),
        Match.when("multipart", () => HttpServerRequest.schemaBodyMultipart(config.schema)),
        Match.when("text", () => Effect.map(HttpServerRequest.HttpServerRequest, r => r.text)),
        Match.exhaustive
      )

      const route = HttpRouter.makeRoute(config.method, config.path, Effect.gen(function*() {
        const body = yield* parseBody
        yield* queue.offer(body)
        return yield* HttpServerResponse.json({ status: "accepted" }, { status: 202 })
      }))

      yield* registry.register(route)
      yield* Effect.logInfo(`[Webhook] Mounted ${config.method} ${config.path}`)
    })
  }
}

// Static Entry Points
export const Webhook = {
  post: (path: HttpRouter.PathInput) => new WebhookTrigger({
    path,
    method: "POST",
    parser: "json",
    schema: Schema.Any
  }),

  get: (path: HttpRouter.PathInput) => new WebhookTrigger({
    path,
    method: "GET",
    parser: "text",
    schema: Schema.Any
  }),

  make: (path: HttpRouter.PathInput) => new WebhookTrigger({
    path,
    method: "POST",
    parser: "json",
    schema: Schema.Any
  })
}
