import { HttpServer } from "@effect/platform"
import { BunHttpServer, BunRuntime, BunClusterSocket } from "@effect/platform-bun"
import { ClusterWorkflowEngine } from "@effect/cluster"
import {
  Effect,
  Layer,
  Logger,
  LogLevel,
} from "effect"
import { PostgresClientLive } from "./services/postgres"
import { TelemetryLive } from "./services/telemetry"
import { EmailProviderLive, EmailService } from "./services/email"
import { CronSchedulerInMemory, CronSchedulerPostgres } from "./services/cron"
import { WalrusBrokerLive } from "./services/walrus"
import { FrameworkConfigLive } from "./core/system/config"
import { RouteRegistry, RouteRegistryLive } from "./core/system"
import { WorkflowTrackerLive } from "./core/system"
import { FrameworkLogger, LogIngressLive } from "./core/system"
import { LokiLogAggregatorLive, DbWorkflowAggregatorLive, SystemRouterLive } from "./core/system"
import { KitchenSinkLive } from "./modules/example"

const isProd = process.env.NODE_ENV === "production"

/**
 * 1. INFRASTRUCTURE LAYER (Providers)
 * 
 * We merge foundation services. provideMerge(PostgresClientLive)
 * ensures SqlClient is available to siblings and exported to the app.
 */
const InfrastructureLayer = Layer.mergeAll(
  ClusterWorkflowEngine.layer.pipe(Layer.provide(BunClusterSocket.layer())),
  TelemetryLive,
  isProd ? CronSchedulerPostgres : CronSchedulerInMemory,
  EmailService.Default.pipe(Layer.provide(EmailProviderLive)),
  RouteRegistryLive,
  FrameworkConfigLive,
  WalrusBrokerLive
).pipe(
  Layer.provideMerge(PostgresClientLive)
)

/**
 * 2. SERVER LAYER
 * 
 * Refactored to be strictly typed and self-contained. 
 * It depends on RouteRegistry to get the HttpApp.
 */
const ServerLive = Layer.scopedDiscard(
  Effect.gen(function*() {
    const registry = yield* RouteRegistry
    yield* HttpServer.serve(registry.app).pipe(
      Layer.provide(BunHttpServer.layer({ port: 3000 })),
      Layer.launch
    )
  })
)

/**
 * 2. TRACKED LOGIC (Business + Server)
 * We provide the Tracker and Loki Logger specifically to these.
 */
const TrackedLogic = Layer.mergeAll(
  ServerLive,
  KitchenSinkLive
).pipe(
  Layer.provide(Logger.add(FrameworkLogger)),
  Layer.provide(WorkflowTrackerLive)
)

/**
 * 3. SILENT SYSTEM (Background Workers)
 * We do NOT provide the Tracker or FrameworkLogger here.
 * They will use the default Console logger and skip Workflow Tracking.
 */
const SilentSystem = Layer.mergeAll(
  LokiLogAggregatorLive,
  DbWorkflowAggregatorLive,
  SystemRouterLive,
  LogIngressLive
)

/**
 * 4. FINAL ASSEMBLY
 */
const MainLayer = Layer.mergeAll(
  TrackedLogic,
  SilentSystem
).pipe(
  // Satisfy SqlClient, Broker, Config, Registry for everyone
  Layer.provide(InfrastructureLayer),
  // Global logging settings (applies to the raw console)
  Layer.provide(Logger.pretty),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info))
)

BunRuntime.runMain(Layer.launch(MainLayer))
