// Binds a trigger definition to a handler: registers metadata and runs the producer.
import { Effect, Layer, ParseResult } from 'effect';

import { FrameworkConfig } from '../system/config';
import { ModuleContext } from '../system/module';
import { CentralQueue, WorkerConfig } from '../system/worker';

import type { TriggerDefinition } from './definition';
import type { TriggerHandler } from './handler';
import { TriggerQueue } from './queue';

/** Binds a definition to a handler under an explicit module id. */
export const bindTriggerIn = <Payload, E, R, A, HE, HR>(
  moduleId: string,
  def: TriggerDefinition<Payload, E, R>,
  handler: TriggerHandler<Payload, A, HE, HR>,
): Layer.Layer<
  never,
  E | HE | ParseResult.ParseError,
  R | Exclude<HR, WorkerConfig> | FrameworkConfig | CentralQueue
> =>
  Layer.scopedDiscard(
    Effect.gen(function*() {
      const configOpt = yield* Effect.serviceOption(FrameworkConfig);
      const centralQueue = yield* CentralQueue;
      const context = yield* Effect.context<HR>();

      if (configOpt._tag === 'Some') {
        yield* configOpt.value.registerTrigger({
          moduleId,
          type: def._tag,
          meta: { ...def.meta, targetGroup: def.targetGroup },
          name: def.triggerName,
          description: def.triggerDescription,
          payloadSchema: def.payloadSchema,
        });
      }

      yield* Effect.logInfo(
        `[Trigger] Booting ${def._tag} -> Queue: [${def.targetGroup}]`,
      ).pipe(
        Effect.annotateLogs({
          ...def.meta,
          moduleId,
          triggerName: def.triggerName ?? '',
          workerGroup: def.targetGroup,
        }),
      );

      const localQueue = TriggerQueue.of({
        offer: (rawPayload) =>
          centralQueue.offer({
            moduleId,
            triggerType: def._tag,
            triggerName: def.triggerName,
            meta: def.meta,
            payloadSchema: def.payloadSchema,
            rawPayload,
            handler,
            context,
            targetGroup: def.targetGroup,
          }),
      });

      const producerEffect = Effect.provideService(def.producer, TriggerQueue, localQueue);

      yield* Effect.forkScoped(
        producerEffect.pipe(
          Effect.catchAllCause((c) =>
            Effect.logError(`[Trigger Producer Crashed] ${def._tag}`, c),
          ),
        ),
      );

      yield* Effect.logInfo(`[Trigger] ${def._tag} successfully started.`);
    }),
  ) as Layer.Layer<
    never,
    E | HE | ParseResult.ParseError,
    R | Exclude<HR, WorkerConfig> | FrameworkConfig | CentralQueue
  >;

/** Binds a definition to a handler, reading the module id from ModuleContext. */
export const bindTrigger = <Payload, E, R, A, HE, HR>(
  def: TriggerDefinition<Payload, E, R>,
  handler: TriggerHandler<Payload, A, HE, HR>,
): Layer.Layer<
  never,
  E | HE | ParseResult.ParseError,
  R | Exclude<HR, WorkerConfig> | FrameworkConfig | ModuleContext | CentralQueue
> =>
  Layer.unwrapEffect(
    Effect.gen(function*() {
      const moduleCtx = yield* ModuleContext;
      return bindTriggerIn(moduleCtx.id, def, handler);
    }),
  );
