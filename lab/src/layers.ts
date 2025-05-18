// Application composition root: wires every subsystem into a single MainLayer.
import { Logger, LogLevel, Layer } from 'effect';

import { OpenObserveTelemetryLive } from './core/telemetry/tracing';
import { ValkeyLive } from './services/valkey';
import {
  FrameworkLoggerLive,
  LogBufferLive,
  RouteRegistryLive,
  ServerLive,
  ExecutionTracker,
  VectorLogForwarderLive,
  DbExecutionAggregatorLive,
  SystemRouterLive,
  MessageBrokerLive,
  CentralQueueLive,
  WorkerPoolLive,
  SseManagerLive,
} from './core/system';
import { FrameworkConfigLive } from './core/system/config';
import { ViewRegistryLive, SystemViewRouterLive, ViewSseStreamResolverLive } from './core/views';
import { ExampleLive } from './modules/example';
import { EmailProviderLive, EmailService } from './services/email';
import { SurrealLive } from './services/surrealdb/engine';
import { IggyClientLive } from './services/iggy/client';
import { RecursionGuardLive } from './core/system/recursion-guard';
import { CronSchedulerValkeyLive } from './services/cron';

// 1. Low-level driver clients & passive infrastructure
const DriversLayer = Layer.mergeAll(
  ValkeyLive,
  SurrealLive,
  IggyClientLive,
  OpenObserveTelemetryLive,
  EmailProviderLive,
  FrameworkConfigLive,
  LogBufferLive,
  RouteRegistryLive,
  ViewRegistryLive,
  RecursionGuardLive({ maxDepth: 15, maxVelocity: 50, velocityWindowMs: 1000 }),
);

// 2. Base services dependent on drivers (Valkey, etc.)
const CoreServicesLayer = Layer.mergeAll(
  CentralQueueLive,
  CronSchedulerValkeyLive,
  EmailService.Default,
).pipe(Layer.provide(DriversLayer));

const BaseServicesLayer = Layer.mergeAll(DriversLayer, CoreServicesLayer);

// 3. Broker and state layers dependent on BaseServices
const MessagingLayer = MessageBrokerLive.pipe(Layer.provide(BaseServicesLayer));
const SseResolverLayer = ViewSseStreamResolverLive.pipe(
  Layer.provide(Layer.merge(BaseServicesLayer, MessagingLayer)),
);
const SseLayer = SseManagerLive.pipe(
  Layer.provide(Layer.mergeAll(BaseServicesLayer, MessagingLayer, SseResolverLayer)),
);
const TrackerLayer = ExecutionTracker.Default.pipe(Layer.provide(Layer.merge(BaseServicesLayer, MessagingLayer)));

const ServicesLayer = Layer.mergeAll(BaseServicesLayer, MessagingLayer, TrackerLayer, SseLayer);

// 4. Telemetry / Logging via Vector
const InfraLayer = Layer.mergeAll(
  DbExecutionAggregatorLive,
  VectorLogForwarderLive,
).pipe(
  Layer.provide(Logger.pretty),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
);

// 5. Application Daemons
const AppLayer = Layer.mergeAll(
  ServerLive,
  WorkerPoolLive([
    { provide: 5, groups: ['default', 'internal', 'system'] },
    { provide: 2, groups: ['webhooks', 'high-priority'] },
  ]),
  SystemRouterLive,
  SystemViewRouterLive,
  ExampleLive,
).pipe(
  Layer.provide(Logger.pretty),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
  Layer.provide(FrameworkLoggerLive),
);

export const MainLayer = Layer.mergeAll(InfraLayer, AppLayer).pipe(
  Layer.provide(ServicesLayer)
);
