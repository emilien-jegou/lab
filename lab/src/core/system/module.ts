// src/core/system/module.ts
import { Context, Layer } from "effect"

export class ModuleContext extends Context.Tag("system/ModuleContext")<
  ModuleContext,
  { readonly id: string }
>() {}

/**
 * Wraps a single composed Layer in the Module Context.
 */
export const defineModule = <A, E, R>(
  id: string,
  layer: Layer.Layer<A, E, R>
) => layer.pipe(
  Layer.provide(Layer.succeed(ModuleContext, { id }))
)
