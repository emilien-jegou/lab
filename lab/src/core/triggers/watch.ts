import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Effect, Schema, Stream, Queue } from "effect"
import { Trigger } from "./base"

export class WatchTrigger<I> extends Trigger<I, PlatformError, FileSystem.FileSystem> {
  readonly _tag = "Watch"

  constructor(
    readonly path: string,
    readonly payloadSchema: Schema.Schema<I, any, any> = Schema.Any as any
  ) {
    super()
  }

  get meta() {
    return { path: this.path }
  }

  schema<NewI>(newSchema: Schema.Schema<NewI, any, any>): WatchTrigger<NewI> {
    return new WatchTrigger(this.path, newSchema)
  }

  protected load(queue: Queue.Queue<unknown>) {
    return Effect.gen(this, function*() {
      const fs = yield* FileSystem.FileSystem
      const stream = fs.watch(this.path)

      yield* Stream.runForEach(stream, (event) =>
        queue.offer(event).pipe(Effect.catchAllCause(() => Effect.void))
      )
    })
  }
}

export const watch = (path: string) => new WatchTrigger(path)
