// System API: aggregates internal HTTP routes and the execution aggregator module.
import { HttpRouter } from '@effect/platform';
import { Effect, Layer } from 'effect';

import { bindTrigger } from '../triggers/binder';
import { stream } from '../triggers/stream';
import { defineModule } from './module';
import { RouteRegistry } from './router';
import { ExecutionEventSchema, SystemExecutionBroker } from './tracker';
import { configRoutes } from './routes/config';
import { executionRoutes } from './routes/executions';
import { logRoutes } from './routes/logs';
import { quarantineRoutes } from './routes/quarantine';
import { sseRoutes } from './routes/sse';

export const DbExecutionAggregatorLive = defineModule(
  'internal',
  bindTrigger(
    stream('system:db-execution-aggregator', SystemExecutionBroker.subscribe())
      .schema(ExecutionEventSchema),
    () => Effect.void,
  ),
);

const systemRoutes: HttpRouter.Route<any, any>[] = [
  ...quarantineRoutes,
  ...configRoutes,
  ...executionRoutes,
  ...sseRoutes,
  ...logRoutes,
];

export const SystemRouterLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const registry = yield* RouteRegistry;
    yield* Effect.forEach(systemRoutes, (route) => registry.register(route));
  }),
);
