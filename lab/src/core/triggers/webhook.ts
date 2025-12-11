import { HttpMethod, HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import type { HttpBodyError } from "@effect/platform/HttpBody"
import type { RequestError } from "@effect/platform/HttpServerError"
import { Effect, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"

type ExecutableWorkflow<I, E, R> = {
  execute: (payload: I) => Effect.Effect<any, E, R>
}

export class WebhookTriggerBuilder<I> {
  constructor(
    private path: HttpRouter.PathInput,
    private method: HttpMethod.HttpMethod = "POST",
    private payloadSchema: Schema.Schema<I, any> = Schema.Any as any
  ) { }

  methodType(method: HttpMethod.HttpMethod) {
    this.method = method
    return this
  }

  schema<NewI>(schema: Schema.Schema<NewI, any>) {
    return new WebhookTriggerBuilder<NewI>(this.path, this.method, schema)
  }

  // The return type is now fully updated to include RequestError.
  workflow<E, R>(handler: (payload: I) => Effect.Effect<any, E, R>): HttpRouter.Route<E | ParseError | HttpBodyError | RequestError, R>
  workflow<E, R>(workflow: ExecutableWorkflow<I, E, R>): HttpRouter.Route<E | ParseError | HttpBodyError | RequestError, R>
  workflow<E, R>(
    handlerOrWorkflow: ((payload: I) => Effect.Effect<any, E, R>) | ExecutableWorkflow<I, E, R>
  ): HttpRouter.Route<E | ParseError | HttpBodyError | RequestError, R> {
    const payloadSchema = this.payloadSchema;

    return HttpRouter.makeRoute(
      this.method,
      this.path,
      Effect.gen(function*() {
        const body = yield* HttpServerRequest.schemaBodyJson(payloadSchema)
        const context = yield* Effect.context<R>()

        let workflowEffect: Effect.Effect<any, E, R>;

        if (typeof handlerOrWorkflow === "function") {
          workflowEffect = handlerOrWorkflow(body);
        } else {
          // it's a workflow:
          workflowEffect = handlerOrWorkflow.execute(body);
        }

        const runnable = workflowEffect.pipe(
          Effect.provide(context),
          Effect.onError((cause) => Effect.logError("Workflow execution failed in fork", cause)),
          Effect.withSpan("workflow.fork")
        )

        yield* Effect.log("Fork daemon");
        yield* Effect.forkDaemon(runnable);

        return yield* HttpServerResponse.json({ status: "accepted" })
      }).pipe(
        // Add a span to the main request handler
        Effect.withSpan("webhook.trigger.handler")
      )
    )
  }
}

export const webhookTrigger = (path: HttpRouter.PathInput) => new WebhookTriggerBuilder(path)
