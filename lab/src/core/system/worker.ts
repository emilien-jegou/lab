// lab/src/core/system/worker.ts
import { Effect, Context, Layer, Schema, Ref, Queue, Tracer } from 'effect';

import type { TriggerHandler } from '../triggers/base';

import { ExecutionTracker } from './tracker';

export interface IWorkerConfig {
  readonly workerId: string;
  readonly subscribedGroups: string[];
  readonly currentTaskGroup: string;
}

export class WorkerConfig extends Context.Tag('system/WorkerConfig')<
  WorkerConfig,
  IWorkerConfig
>() { }

export interface WorkerProvisionConfig {
  readonly provide: number;
  readonly groups: string[];
}

export interface Job {
  readonly moduleId: string;
  readonly triggerType: string;
  readonly triggerName?: string;
  readonly meta: Record<string, unknown>;
  readonly rawPayload: unknown;
  readonly payloadSchema: Schema.Schema<any, any, any>;
  readonly handler: TriggerHandler<any, any, any, any>;
  readonly context: Context.Context<any>;
  readonly targetGroup: string;
}

export class CentralQueue extends Context.Tag('system/CentralQueue')<
  CentralQueue,
  {
    readonly offer: (job: Job) => Effect.Effect<void>;
    readonly take: (groups: string[]) => Effect.Effect<Job>;
  }
>() { }

export const CentralQueueLive: Layer.Layer<CentralQueue> = Layer.effect(
  CentralQueue,
  Effect.gen(function*() {
    console.log('[CentralQueueLive] Initializing CentralQueue instance...');
    const queues = yield* Ref.make(new Map<string, Queue.Queue<Job>>());

    const getOrCreateQueue = (group: string) =>
      Effect.gen(function*() {
        const q = yield* Queue.unbounded<Job>();
        return yield* Ref.modify(queues, (map) => {
          if (map.has(group)) return [map.get(group)!, map] as const;
          return [q, new Map(map).set(group, q)] as const;
        });
      });

    return CentralQueue.of({
      offer: (job) =>
        Effect.gen(function*() {
          const group = job.targetGroup || 'default';
          const q = yield* getOrCreateQueue(group);
          yield* Queue.offer(q, job);
        }),
      take: (groups) =>
        Effect.gen(function*() {
          const safeGroups = groups.length > 0 ? groups : ['default'];
          const qs = yield* Effect.forEach(safeGroups, getOrCreateQueue);
          const first = qs[0];

          if (!first) {
            const fallback = yield* getOrCreateQueue('default');
            return yield* Queue.take(fallback);
          }

          if (qs.length === 1) {
            return yield* Queue.take(first);
          }

          return yield* Effect.raceAll(qs.map((q) => Queue.take(q)));
        }),
    });
  }),
);

// Parses standard W3C traceparent header: 00-<trace_id>-<span_id>-<flags>
const parseTraceparent = (header?: string) => {
  if (!header || typeof header !== 'string') return undefined;
  const parts = header.split('-');
  if (parts.length >= 4 && parts[1] && parts[2]) {
    return Tracer.externalSpan({
      traceId: parts[1],
      spanId: parts[2],
    });
  }
  return undefined;
};

export const WorkerPoolLive = (
  configs: WorkerProvisionConfig[] = [
    { provide: 5, groups: ['default', 'internal', 'system'] },
    { provide: 2, groups: ['webhooks', 'high-priority'] },
  ],
): Layer.Layer<never, never, CentralQueue | ExecutionTracker> =>
  Layer.scopedDiscard(
    Effect.gen(function*() {
      console.log('[WorkerPoolLive] Starting WorkerPoolLive...');
      const queue = yield* CentralQueue;
      const trackerOpt = yield* Effect.serviceOption(ExecutionTracker);

      const processJob = (job: Job, workerCtx: IWorkerConfig): Effect.Effect<void> =>
        Effect.gen(function*() {
          const startTime = Date.now();
          const isInternal =
            job.moduleId === 'internal' || job.triggerType.toLowerCase() === 'logger';

          // 1. Extract traceparent and clean raw payload so Schema validation never fails
          let cleanPayload = job.rawPayload;
          let traceparentHeader: string | undefined;

          if (typeof cleanPayload === 'object' && cleanPayload !== null) {
            if ('_traceparent' in cleanPayload) {
              const { _traceparent, ...rest } = cleanPayload as Record<string, unknown>;
              traceparentHeader = typeof _traceparent === 'string' ? _traceparent : undefined;
              cleanPayload = rest;
            }
          }

          if (!traceparentHeader && (job.meta as any)?.traceparent) {
            traceparentHeader = (job.meta as any).traceparent;
          }

          const parentSpan = parseTraceparent(traceparentHeader);

          // 2. Decode payload
          const payload = yield* (
            Schema.decodeUnknown(job.payloadSchema)(cleanPayload) as Effect.Effect<
              any,
              any,
              never
            >
          ).pipe(
            Effect.tapErrorCause((c) =>
              Effect.sync(() =>
                console.error(`[Worker: ${workerCtx.workerId}] Schema decode failed:`, c),
              ),
            ),
            Effect.catchAllCause((c) => Effect.die(c)),
          );

          // 3. Execution ID
          const executionId =
            trackerOpt._tag === 'Some'
              ? yield* trackerOpt.value.start({
                  moduleId: job.moduleId,
                  triggerType: job.triggerType,
                  triggerName: job.triggerName,
                  meta: {
                    ...job.meta,
                    workerId: workerCtx.workerId,
                    taskGroup: workerCtx.currentTaskGroup,
                    subscribedGroups: workerCtx.subscribedGroups,
                  },
                  payload,
                })
              : crypto.randomUUID();

          if (!isInternal) {
            console.log(
              `[Worker: ${workerCtx.workerId}] >>> Execution started: ${executionId} (${job.triggerType})`,
            );
          }

          const rawEffect =
            typeof job.handler === 'function' ? job.handler(payload) : job.handler.execute(payload);

          const taskAnnotations = {
            executionId,
            moduleId: job.moduleId,
            triggerType: job.triggerType,
            workerId: workerCtx.workerId,
            taskGroup: workerCtx.currentTaskGroup,
            ...(job.triggerName ? { triggerName: job.triggerName } : {}),
          };

          const taskSpanAttributes = {
            'job.execution_id': executionId,
            'job.module_id': job.moduleId,
            'job.trigger_type': job.triggerType,
            'job.worker_id': workerCtx.workerId,
            'job.task_group': workerCtx.currentTaskGroup,
            ...(job.triggerName ? { 'job.trigger_name': job.triggerName } : {}),
          };

          // 4. Wrap with context, distributed trace hierarchy, and log annotations
          const runnable = (rawEffect as Effect.Effect<unknown, unknown, never>).pipe(
            Effect.provide(job.context),
            Effect.provideService(WorkerConfig, workerCtx),
            Effect.tapErrorCause((cause) =>
              Effect.gen(function*() {
                const durationMs = Date.now() - startTime;
                yield* Effect.annotateCurrentSpan({
                  'job.duration_ms': durationMs,
                  'job.status': 'failed',
                });
                console.error(
                  `\n❌ [Worker Failure] Worker "${workerCtx.workerId}" failed executing "${job.triggerType}" (${executionId}) after ${durationMs}ms:\n`,
                  cause,
                  '\n',
                );
                if (!isInternal) {
                  yield* Effect.logError(
                    `[Worker Failure] ${job.triggerType} (${executionId}) failed after ${durationMs}ms`,
                    cause,
                  );
                }
                if (trackerOpt._tag === 'Some') {
                  yield* trackerOpt.value.fail(executionId, cause);
                }
              }),
            ),
            Effect.tap(() =>
              Effect.gen(function*() {
                const durationMs = Date.now() - startTime;
                yield* Effect.annotateCurrentSpan({
                  'job.duration_ms': durationMs,
                  'job.status': 'completed',
                });
                if (!isInternal) {
                  yield* Effect.logInfo(
                    `[Worker] Finished ${job.triggerType} (${executionId}) in ${durationMs}ms`,
                  );
                }
                if (trackerOpt._tag === 'Some') {
                  yield* trackerOpt.value.complete(executionId);
                }
              }),
            ),
            // OpenTelemetry trace span (nests under parentSpan if propagated)
            Effect.withSpan(`job:${job.triggerType}`, {
              attributes: taskSpanAttributes,
              ...(parentSpan ? { parent: parentSpan } : {}),
            }),
            Effect.annotateLogs(taskAnnotations),
          );

          yield* runnable;
        }).pipe(
          Effect.catchAllCause((c) =>
            Effect.logError(`[Trigger Worker Failed] ${job.triggerType}`, c),
          ),
        );

      let totalWorkers = 0;
      let workerIndex = 1;

      for (const config of configs) {
        for (let i = 0; i < config.provide; i++) {
          totalWorkers++;
          const workerId = `worker-${workerIndex++}`;
          const subscribedGroups = [...config.groups];

          const workerLoop = Effect.gen(function*() {
            const job = yield* queue.take(subscribedGroups);
            const workerCtx: IWorkerConfig = {
              workerId,
              subscribedGroups,
              currentTaskGroup: job.targetGroup || 'default',
            };
            yield* processJob(job, workerCtx);
          }).pipe(
            Effect.forever,
            Effect.annotateLogs({ workerId, groups: subscribedGroups.join(',') }),
          );

          yield* Effect.forkScoped(workerLoop);
        }
      }

      console.log(`[WorkerPoolLive] Successfully started ${totalWorkers} workers.`);
    }),
  );
