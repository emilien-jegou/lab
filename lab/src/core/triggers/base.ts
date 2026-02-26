import { Effect, Schema, ParseResult, Layer, Context } from 'effect';

import { FrameworkConfig } from '../system/config';
import { ModuleContext } from '../system/module';
import { CentralQueue, WorkerConfig } from '../system/worker';

export type Executable<I, A, E, R> = {
  readonly execute: (payload: I) => Effect.Effect<A, E, R>;
};

export type TriggerHandler<I, A, E, R> =
  | ((payload: I) => Effect.Effect<A, E, R>)
  | Executable<I, A, E, R>;

export class TriggerQueue extends Context.Tag('system/TriggerQueue')<
  TriggerQueue,
  { readonly offer: (payload: unknown) => Effect.Effect<void> }
>() { }

export interface Trigger<Payload, E, R> {
  readonly _tag: string;
  readonly meta: Record<string, unknown>;
  readonly payloadSchema: Schema.Schema<Payload, any, any>;
  readonly producer: Effect.Effect<void, E, R | TriggerQueue>;
  readonly triggerName?: string;
  readonly triggerDescription?: string;
  readonly targetGroup: string;

  readonly name: (name: string) => Trigger<Payload, E, R>;
  readonly describe: (description: string) => Trigger<Payload, E, R>;
  readonly workerGroup: (group: string) => Trigger<Payload, E, R>;

  readonly bind: <A, HE, HR>(
    handler: TriggerHandler<Payload, A, HE, HR>,
  ) => Layer.Layer<
    never,
    E | HE | ParseResult.ParseError,
    R | Exclude<HR, WorkerConfig> | FrameworkConfig | ModuleContext | CentralQueue
  >;

  readonly bindAsLayer: <A, HE, HR>(
    moduleId: string,
    handler: TriggerHandler<Payload, A, HE, HR>,
  ) => Layer.Layer<
    never,
    E | HE | ParseResult.ParseError,
    R | Exclude<HR, WorkerConfig> | FrameworkConfig | CentralQueue
  >;
}

export const make = <Payload, E, R>(
  _tag: string,
  meta: Record<string, unknown>,
  payloadSchema: Schema.Schema<Payload, any, any>,
  producer: Effect.Effect<void, E, R | TriggerQueue>,
  triggerName?: string,
  triggerDescription?: string,
  targetGroup: string = 'default',
): Trigger<Payload, E, R> => ({
  _tag,
  meta,
  payloadSchema,
  producer,
  triggerName,
  triggerDescription,
  targetGroup,

  name(name: string) {
    return make(_tag, meta, payloadSchema, producer, name, triggerDescription, targetGroup);
  },

  describe(description: string) {
    return make(_tag, meta, payloadSchema, producer, triggerName, description, targetGroup);
  },

  workerGroup(group: string) {
    return make(_tag, meta, payloadSchema, producer, triggerName, triggerDescription, group);
  },

  bind<A, HE, HR>(handler: TriggerHandler<Payload, A, HE, HR>) {
    return Layer.unwrapEffect(
      Effect.gen(this, function*() {
        const moduleCtx = yield* ModuleContext;
        return this.bindAsLayer(moduleCtx.id, handler);
      }),
    );
  },

  bindAsLayer<A, HE, HR>(moduleId: string, handler: TriggerHandler<Payload, A, HE, HR>) {
    return Layer.scopedDiscard(
      Effect.gen(this, function*() {
        const configOpt = yield* Effect.serviceOption(FrameworkConfig);
        const centralQueue = yield* CentralQueue;

        const context = yield* Effect.context<HR>();

        if (configOpt._tag === 'Some') {
          yield* configOpt.value.registerTrigger({
            moduleId,
            type: this._tag,
            // Tuck targetGroup safely into meta
            meta: { ...this.meta, targetGroup: this.targetGroup },
            name: this.triggerName,
            description: this.triggerDescription,
            payloadSchema: this.payloadSchema,
          });
        }

        yield* Effect.logInfo(
          `[Trigger] Booting ${this._tag} -> Queue: [${this.targetGroup}]`,
        ).pipe(
          Effect.annotateLogs({
            ...this.meta,
            moduleId,
            triggerName: this.triggerName ?? '',
            workerGroup: this.targetGroup,
          }),
        );

        const localQueue = TriggerQueue.of({
          offer: (rawPayload) =>
            centralQueue.offer({
              moduleId,
              triggerType: this._tag,
              triggerName: this.triggerName,
              meta: this.meta,
              payloadSchema: this.payloadSchema,
              rawPayload,
              handler,
              context,
              targetGroup: this.targetGroup,
            }),
        });

        const producerEffect = Effect.provideService(this.producer, TriggerQueue, localQueue);

        yield* Effect.forkScoped(
          producerEffect.pipe(
            Effect.catchAllCause((c) =>
              Effect.logError(`[Trigger Producer Crashed] ${this._tag}`, c),
            ),
          ),
        );

        yield* Effect.logInfo(`[Trigger] ${this._tag} successfully started.`);
      }),
    ) as Layer.Layer<
      never,
      E | HE | ParseResult.ParseError,
      R | Exclude<HR, WorkerConfig> | FrameworkConfig | CentralQueue
    >;
  },
});
