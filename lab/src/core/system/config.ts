import { Context, Effect, Layer, Ref, Schema } from "effect"

export interface TriggerInfo {
  readonly type: string;
  readonly meta: any;
  readonly name?: string;
  readonly description?: string;
  readonly payloadSchema: Schema.Schema<any, any, any>; // Added schema
}

export interface ModuleInfo { readonly id: string; readonly triggers: TriggerInfo[] }

export class FrameworkConfig extends Context.Tag("system/FrameworkConfig")<
  FrameworkConfig,
  {
    readonly registerTrigger: (options: {
      moduleId: string;
      type: string;
      meta: any;
      name?: string;
      description?: string;
      payloadSchema: Schema.Schema<any, any, any>;
    }) => Effect.Effect<void>;
    readonly getInfo: Effect.Effect<{ modules: ModuleInfo[] }>;
  }
>() { }

export const FrameworkConfigLive = Layer.effect(
  FrameworkConfig,
  Effect.gen(function*() {
    const storage = yield* Ref.make<Record<string, ModuleInfo>>({})

    return {
      registerTrigger: (options) =>
        Ref.update(storage, (curr) => {
          const { moduleId, ...triggerData } = options
          const mod = curr[moduleId] ?? { id: moduleId, triggers: [] }
          return {
            ...curr,
            [moduleId]: {
              ...mod,
              triggers: [...mod.triggers, triggerData]
            }
          }
        }),
      getInfo: Effect.gen(function*() {
        const data = yield* Ref.get(storage)
        return { modules: Object.values(data) }
      })
    }
  })
)
