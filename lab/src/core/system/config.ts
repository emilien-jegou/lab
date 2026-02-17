import { Context, Effect, Layer, Ref } from "effect"

export interface TriggerInfo { readonly type: string; readonly meta: any }
export interface ModuleInfo { readonly id: string; readonly triggers: TriggerInfo[] }

export class FrameworkConfig extends Context.Tag("system/FrameworkConfig")<
  FrameworkConfig,
  {
    readonly registerTrigger: (moduleId: string, type: string, meta: any) => Effect.Effect<void>
    readonly getInfo: Effect.Effect<{ modules: ModuleInfo[] }>
  }
>() { }

export const FrameworkConfigLive = Layer.effect(
  FrameworkConfig,
  Effect.gen(function*() {
    const storage = yield* Ref.make<Record<string, ModuleInfo>>({})

    return {
      registerTrigger: (moduleId, type, meta) =>
        Ref.update(storage, (curr) => {
          const mod = curr[moduleId] ?? { id: moduleId, triggers: [] }
          return {
            ...curr,
            [moduleId]: {
              ...mod,
              triggers: [...mod.triggers, { type, meta }]
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
