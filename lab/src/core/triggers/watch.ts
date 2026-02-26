import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, Schema, Stream } from "effect"
import * as Base from "./base"

export interface WatchTriggerDef<I> extends Base.Trigger<I, PlatformError, FileSystem.FileSystem> {
  readonly schema: <NewI>(newSchema: Schema.Schema<NewI, any, any>) => WatchTriggerDef<NewI>
}

export const watch = <I = unknown>(
  path: string,
  payloadSchema: Schema.Schema<I, any, any> = Schema.Any as any
): WatchTriggerDef<I> => {
  const producer = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const queue = yield* Base.TriggerQueue // Standard yielded queue service

    const stream = fs.watch(path)

    yield* Stream.runForEach(stream, (event) =>
      queue.offer(event).pipe(Effect.catchAllCause(() => Effect.void))
    )
  })

  return {
    ...Base.make("Watch", { path }, payloadSchema, producer),
    schema: (newSchema) => watch(path, newSchema)
  }
}
