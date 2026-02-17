import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { SqlClient } from "@effect/sql"
import { Effect, Schema, Layer } from "effect"
import { defineBroker } from "./broker"
import { FrameworkConfig } from "./config"
import { WorkflowTracker } from "./tracker"
import { RouteRegistry } from "./router"
import { stream } from "../triggers/stream"

const WorkflowEventSchema = Schema.Union(
  Schema.Struct({
    action: Schema.Literal("start"),
    id: Schema.String,
    triggerType: Schema.String,
    meta: Schema.Unknown,
    payload: Schema.Unknown,
    timestamp: Schema.Number
  }),
  Schema.Struct({
    action: Schema.Literal("complete"),
    id: Schema.String,
    timestamp: Schema.Number
  }),
  Schema.Struct({
    action: Schema.Literal("fail"),
    id: Schema.String,
    error: Schema.String,
    timestamp: Schema.Number
  })
)

export const SystemWorkflowBroker = defineBroker('system:workflows', WorkflowEventSchema);

export const DbWorkflowAggregatorLive = stream("db-workflow-aggregator", SystemWorkflowBroker.subscribe())
  .schema(WorkflowEventSchema)
  .bindAsLayer((payload) =>
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      if (payload.action === "start") {
        yield* sql`
          INSERT INTO system_workflow_runs (id, trigger_type, status, start_time, meta, payload) 
          VALUES (
            ${payload.id},
            ${payload.triggerType},
            'running',
            ${payload.timestamp},
            ${JSON.stringify(payload.meta)},
            ${JSON.stringify(payload.payload)}
          )
        `
      } else if (payload.action === "complete") {
        yield* sql`UPDATE system_workflow_runs SET status = 'completed', end_time = ${payload.timestamp} WHERE id = ${payload.id}`
      } else if (payload.action === "fail") {
        yield* sql`UPDATE system_workflow_runs SET status = 'failed', end_time = ${payload.timestamp}, error = ${payload.error} WHERE id = ${payload.id}`
      }
    }).pipe(
      Effect.catchAllCause((c) => Effect.logError("Workflow DB update failed", c))
    )
  )

const SystemRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/__system/conf", Effect.gen(function*() {
    const configSvc = yield* FrameworkConfig
    return yield* HttpServerResponse.json({ configuration: yield* configSvc.getInfo })
  })),

  HttpRouter.get("/__system/runs", Effect.gen(function*() {
    const trackerOpt = yield* Effect.serviceOption(WorkflowTracker)
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    if (trackerOpt._tag === "None") return yield* HttpServerResponse.json({ data: [] })
    const filters = {
      limit: parseInt(url.searchParams.get("limit") || "50", 10),
      offset: parseInt(url.searchParams.get("offset") || "0", 10),
      status: url.searchParams.get("status") || null,
      type: url.searchParams.get("type") || null
    }
    const [runs, total] = yield* Effect.all([trackerOpt.value.getRuns(filters), trackerOpt.value.countRuns(filters)], { concurrency: 2 })
    return yield* HttpServerResponse.json({ data: runs, meta: { total, ...filters } })
  })),

  HttpRouter.get("/__system/logs", Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    const lokiUrl = process.env.LOKI_URL || "http://localhost:3100"
    const params = new URLSearchParams({
      query: url.searchParams.get("runId") ? `{app="lab", runId="${url.searchParams.get("runId")}"}` : `{app="lab"}`,
      limit: url.searchParams.get("limit") || "100",
      direction: "backward"
    })
    const response = yield* Effect.tryPromise({
      try: () => fetch(`${lokiUrl}/loki/api/v1/query_range?${params}`).then((r) => r.json()),
      catch: () => new Error("Loki fetch failed")
    }).pipe(Effect.catchAll(() => Effect.succeed({ error: "Loki query failed" })))
    return yield* HttpServerResponse.json(response)
  }))
)

export const SystemRouterLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const registry = yield* RouteRegistry
    yield* Effect.forEach(SystemRouter.routes, (route) => registry.register(route))
  })
)
