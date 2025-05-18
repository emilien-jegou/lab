// Job processing pipeline: schema decoding, execution tracking, and telemetry.
import { Effect, Schema, Tracer } from 'effect';

import type { Job } from './job';
import type { IWorkerConfig } from './worker-config';
import { WorkerConfig } from './worker-config';
import { ExecutionTracker } from './tracker';

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

export const processJob = (job: Job, workerCtx: IWorkerConfig): Effect.Effect<void> =>
  Effect.gen(function*() {
    const startTime = Date.now();
    const isInternal =
      job.moduleId === 'internal' || job.triggerType.toLowerCase() === 'logger';

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

    const trackerOpt = yield* Effect.serviceOption(ExecutionTracker);

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
