import { Effect, Layer } from 'effect';
import { ModuleContext } from '../system/module';
import {
  activeBuildContext,
  currentViewBuildContext,
  setActiveBuildContext,
  ViewBuildContext,
} from './live';
import { ViewRegistry } from './registry';
import type { RegisteredView, ViewComponent, ViewConfig } from './types';

export interface ViewDef<Type extends string = string> {
  readonly meta: ViewConfig & { readonly type: Type };

  readonly show: <E, R>(
    layoutEffect: Effect.Effect<readonly ViewComponent[], E, R> | readonly ViewComponent[],
  ) => Layer.Layer<never, E, R | ViewRegistry | ModuleContext>;
}

const makeViewLayer = <E, R>(
  config: ViewConfig & { readonly type: string },
  layoutInput: Effect.Effect<readonly ViewComponent[], E, R> | readonly ViewComponent[],
): Layer.Layer<never, E, R | ViewRegistry | ModuleContext> =>
  Layer.scopedDiscard(
    Effect.gen(function*() {
      const moduleOpt = yield* Effect.serviceOption(ModuleContext);
      const moduleId = moduleOpt._tag === 'Some' ? moduleOpt.value.id : 'default';
      const registry = yield* ViewRegistry;
      const context = yield* Effect.context<R>();

      const buildContext = new ViewBuildContext(config.id);

      const layoutEffect = Effect.isEffect(layoutInput)
        ? layoutInput
        : Effect.succeed(layoutInput);

      const prevActive = activeBuildContext;
      setActiveBuildContext(buildContext);

      let layout: readonly ViewComponent[];
      try {
        layout = yield* Effect.locally(
          layoutEffect,
          currentViewBuildContext,
          buildContext,
        );
      } finally {
        setActiveBuildContext(prevActive);
      }

      // Auto-scan layout component tree to index all live refs and actions
      buildContext.scanTree(layout);

      const registeredView: RegisteredView = {
        meta: {
          id: config.id,
          name: config.name,
          description: config.description,
          tags: config.tags ?? [],
          type: config.type,
          moduleId,
        },
        layout,
        queries: buildContext.queries,
        streams: buildContext.streams,
        actions: buildContext.actions,
        context,
      };

      yield* registry.register(registeredView);

      yield* Effect.logInfo(
        `[View] Registered view "${config.name}" (${config.id}) [${config.type}] for module [${moduleId}]`,
      ).pipe(
        Effect.annotateLogs({
          viewId: config.id,
          viewType: config.type,
          moduleId,
        }),
      );
    }),
  );

export const view = (config: ViewConfig) => ({
  dashboard: (): ViewDef<'dashboard'> => ({
    meta: { ...config, type: 'dashboard' },
    show: (layoutEffect) => makeViewLayer({ ...config, type: 'dashboard' }, layoutEffect),
  }),

  page: (): ViewDef<'page'> => ({
    meta: { ...config, type: 'page' },
    show: (layoutEffect) => makeViewLayer({ ...config, type: 'page' }, layoutEffect),
  }),

  custom: (type: string): ViewDef<string> => ({
    meta: { ...config, type },
    show: (layoutEffect) => makeViewLayer({ ...config, type }, layoutEffect),
  }),
});
