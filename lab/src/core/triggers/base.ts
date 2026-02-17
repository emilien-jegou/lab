import { Effect, Schema, Stream, ParseResult, Queue, Layer } from "effect"
import { WorkflowTracker } from "../system/tracker"
import { FrameworkConfig } from "../system/config" // Direct import

export type Executable<I, A, E, R> = {
  readonly execute: (payload: I) => Effect.Effect<A, E, R>
}

export type TriggerHandler<I, A, E, R> =
  | ((payload: I) => Effect.Effect<A, E, R>)
  | Executable<I, A, E, R>

export abstract class Trigger<Payload, E, R> {
  abstract readonly _tag: string
  abstract readonly meta: Record<string, unknown>
  abstract readonly payloadSchema: Schema.Schema<Payload, any, any>

  protected abstract load(queue: Queue.Queue<unknown>): Effect.Effect<void, E, R>

  bindAsLayer<A, HE, HR>(
    handler: TriggerHandler<Payload, A, HE, HR>,
    moduleId: string = "default"
  ): Layer.Layer<never, E | HE | ParseResult.ParseError, R | HR | FrameworkConfig> {
    return Layer.scopedDiscard(
      Effect.gen(this, function*() {
        const configOpt = yield* Effect.serviceOption(FrameworkConfig)
        if (configOpt._tag === "Some") {
          yield* configOpt.value.registerTrigger(moduleId, this._tag, this.meta)
        }

        yield* Effect.logInfo(`[Trigger] Booting ${this._tag}...`).pipe(
          Effect.annotateLogs({ ...this.meta, moduleId })
        )

        const queue = yield* Queue.unbounded<unknown>()
        yield* Effect.forkScoped(
          this.load(queue).pipe(
            Effect.catchAllCause((c) =>
              Effect.logError(`[Trigger Producer Crashed] ${this._tag}`, c)
            )
          )
        )

        const stream = Stream.fromQueue(queue)
        yield* Stream.runForEach(stream, (raw) =>
          Effect.gen(this, function*() {
            const payload = yield* Schema.decodeUnknown(this.payloadSchema)(raw).pipe(
              Effect.catchAllCause((c) => Effect.die(c))
            )

            const effect = typeof handler === "function" ? handler(payload) : handler.execute(payload)
            const trackerOpt = yield* Effect.serviceOption(WorkflowTracker)

            const pipeline =
              trackerOpt._tag === "None"
                ? effect
                : Effect.gen(this, function*() {
                  const runId = yield* trackerOpt.value.start(this._tag, this.meta, payload)
                  return yield* effect.pipe(
                    Effect.tapErrorCause((c) => trackerOpt.value.fail(runId, c)),
                    Effect.tap(() => trackerOpt.value.complete(runId))
                  )
                })

            yield* pipeline.pipe(
              Effect.catchAllCause((c) =>
                Effect.logError(`[Trigger Worker Failed] ${this._tag}`, c)
              ),
              Effect.fork
            )
          })
        ).pipe(
          Effect.catchAllCause((c) =>
            Effect.logError(`[Trigger Consumer Crashed] ${this._tag}`, c)
          ),
          Effect.forkScoped
        )

        yield* Effect.logInfo(`[Trigger] ${this._tag} successfully started.`)
      })
    )
  }
}
