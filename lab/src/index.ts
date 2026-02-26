// lab/src/index.ts
import { BunRuntime } from '@effect/platform-bun';
import { Layer, Logger, LogLevel } from 'effect';
import { OpenObserveTelemetryLive } from './core/telemetry/tracing';

import {
  FrameworkLogger,
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
import { ViewRegistryLive, SystemViewRouterLive } from './core/views';
import { ExampleLive } from './modules/example';
import { CronSchedulerInMemory } from './services/cron';
import { EmailProviderLive, EmailService } from './services/email';
import { SurrealLive } from './services/surrealdb/engine';
import { IggyClientLive } from './services/iggy/client';
import { RecursionGuardLive } from './core/system/recursion-guard';

// 1. Base passive services & clients
const BaseServicesLayer = Layer.mergeAll(
  RecursionGuardLive({ maxDepth: 15, maxVelocity: 50, velocityWindowMs: 1000 }),
  CentralQueueLive,
  SurrealLive,
  IggyClientLive,
  OpenObserveTelemetryLive,
  CronSchedulerInMemory,
  EmailService.Default.pipe(Layer.provide(EmailProviderLive)),
  FrameworkConfigLive,
  RouteRegistryLive,
  ViewRegistryLive,
);

// 2. Broker and state layers dependent on BaseServices
const MessagingLayer = MessageBrokerLive.pipe(Layer.provide(BaseServicesLayer));
const SseLayer = SseManagerLive.pipe(Layer.provide(Layer.merge(BaseServicesLayer, MessagingLayer)));
const TrackerLayer = ExecutionTracker.Default.pipe(Layer.provide(Layer.merge(BaseServicesLayer, MessagingLayer)));

const ServicesLayer = Layer.mergeAll(BaseServicesLayer, MessagingLayer, TrackerLayer, SseLayer);

// 3. Telemetry / Logging via Vector
const InfraLayer = Layer.mergeAll(
  DbExecutionAggregatorLive,
  VectorLogForwarderLive,
).pipe(
  Layer.provide(Logger.pretty),
  Layer.provide(Logger.minimumLogLevel(LogLevel.Info)),
);

// 4. Application Daemons
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
  Layer.provide(Logger.add(FrameworkLogger)),
);

const MainLayer = Layer.mergeAll(InfraLayer, AppLayer).pipe(
  Layer.provide(ServicesLayer)
);

BunRuntime.runMain(Layer.launch(MainLayer));
