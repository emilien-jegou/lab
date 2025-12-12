import { BunRuntime } from "@effect/platform-bun"
import { Layer, Logger, LogLevel } from "effect"
import { WorkflowEngineLayer } from "./core/engine"
import { ServerLayer } from "./core/server"
import { BaserowWorkflowLive } from "./flows/baserow-updater"
import { EmailService, EmailProviderLive } from "./services/email"
import { TelemetryLive } from "./services/telemetry"

const WorkflowsLayer = Layer.mergeAll(
  BaserowWorkflowLive
)

const MainLayer = Layer.mergeAll(
  ServerLayer,
  WorkflowsLayer
).pipe(
  Layer.provide(EmailService.Default),
  Layer.provide(EmailProviderLive),
  Layer.provideMerge(WorkflowEngineLayer),
  Layer.provide(TelemetryLive),
  Layer.provide(Logger.pretty),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info))
)

BunRuntime.runMain(Layer.launch(MainLayer))
