import { Context, Effect, Layer, Option, Ref } from 'effect';
import type { RegisteredView } from './types';

export class ViewRegistry extends Context.Tag('system/ViewRegistry')<
  ViewRegistry,
  {
    readonly register: (view: RegisteredView) => Effect.Effect<void>;
    readonly get: (id: string) => Effect.Effect<Option.Option<RegisteredView>>;
    readonly list: () => Effect.Effect<readonly RegisteredView[]>;
  }
>() {}

export const ViewRegistryLive: Layer.Layer<ViewRegistry> = Layer.effect(
  ViewRegistry,
  Effect.gen(function*() {
    const storage = yield* Ref.make<Map<string, RegisteredView>>(new Map());

    return ViewRegistry.of({
      register: (view) =>
        Ref.update(storage, (map) => new Map(map).set(view.meta.id, view)),
      get: (id) =>
        Effect.map(Ref.get(storage), (map) => Option.fromNullable(map.get(id))),
      list: () =>
        Effect.map(Ref.get(storage), (map) => Array.from(map.values())),
    });
  }),
);
