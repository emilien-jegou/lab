// lab/src/core/system/tracker.ts
import { Effect, Schema, Stream } from 'effect';

import { document } from '~/services/surrealdb/api';
import { dbschema, id as surrealId } from '~/services/surrealdb/api-builder';

import { defineBroker, MessageBroker, type BrokerPayload } from './broker';

export const ExecutionEventSchema = Schema.Union(
  Schema.Struct({
    action: Schema.Literal('start'),
    id: Schema.String,
    moduleId: Schema.String,
    triggerType: Schema.String,
    triggerName: Schema.optional(Schema.String),
    meta: Schema.Unknown,
    payload: Schema.Unknown,
    timestamp: Schema.Number,
  }),
  Schema.Struct({
    action: Schema.Literal('complete'),
    id: Schema.String,
    timestamp: Schema.Number,
  }),
  Schema.Struct({
    action: Schema.Literal('fail'),
    id: Schema.String,
    error: Schema.String,
    timestamp: Schema.Number,
  }),
);

export const SystemExecutionBroker = defineBroker('system:executions', ExecutionEventSchema);

export const ExecutionRecordSchema = Schema.Struct({
  id: Schema.String,
  moduleId: Schema.String,
  triggerType: Schema.String,
  triggerName: Schema.optional(Schema.String),
  status: Schema.Literal('running', 'completed', 'failed'),
  startTime: Schema.Number,
  endTime: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  meta: Schema.Any,
  payload: Schema.Any,
});

export type ExecutionRecord = Schema.Schema.Type<typeof ExecutionRecordSchema>;

export const ExecutionDocument = document('system_executions', ExecutionRecordSchema);
export const executionSchema = dbschema(ExecutionDocument);

export interface ExecutionFilters {
  readonly limit: number;
  readonly offset: number;
  readonly status?: string | null;
  readonly type?: string | null;
  readonly moduleId?: string | null;
}

// Sanitizes internal errors: strips file paths, stack traces, and internal frame dumps
const sanitizeErrorMessage = (error: unknown): string => {
  if (!error) return 'Execution failed';
  const rawMsg =
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string'
      ? (error as any).message
      : error instanceof Error
        ? error.message
        : String(error);

  const firstLine = (rawMsg.split('\n')[0] ?? 'Execution failed').trim();
  return firstLine.replace(/at\s+.*$/g, '').trim() || 'Execution failed';
};

export class ExecutionTracker extends Effect.Service<ExecutionTracker>()('ExecutionTracker', {
  effect: Effect.gen(function*() {
    const brokerInstance = yield* MessageBroker;
    const db = yield* executionSchema.asEffect();

    const buildWhere = (f: Omit<ExecutionFilters, 'limit' | 'offset'>) => {
      const clause: Record<string, any> = {};
      if (f.status) clause.status = f.status;
      if (f.moduleId) clause.moduleId = f.moduleId;
      if (f.type) clause.triggerType = f.type;
      return clause;
    };

    const sendExecutionEvent = (event: BrokerPayload<typeof SystemExecutionBroker>) =>
      SystemExecutionBroker.publish(event).pipe(
        Effect.provideService(MessageBroker, brokerInstance),
        Effect.orDie,
      );

    return {
      start: (args: {
        moduleId: string;
        triggerType: string;
        triggerName?: string;
        meta: any;
        payload: any;
      }): Effect.Effect<string> =>
        Effect.gen(function*() {
          // Prevent infinite loops from internal system triggers
          if (args.triggerType.startsWith('system-') || args.moduleId === 'internal') {
            return `internal_${crypto.randomUUID()}`;
          }
          const id = crypto.randomUUID();
          const timestamp = Date.now();

          // 1. Direct write to SurrealDB
          yield* db
            .doc('system_executions')
            .create({
              id,
              moduleId: args.moduleId,
              triggerType: args.triggerType,
              triggerName: args.triggerName,
              status: 'running',
              startTime: timestamp,
              meta: args.meta,
              payload: args.payload,
            })
            .toEffect()
            .pipe(
              Effect.catchAllCause((cause) =>
                Effect.logError('[ExecutionTracker] Failed to insert execution start', cause),
              ),
            );

          // 2. Publish to broker
          yield* sendExecutionEvent({
            action: 'start',
            id,
            moduleId: args.moduleId,
            triggerType: args.triggerType,
            triggerName: args.triggerName,
            meta: args.meta,
            payload: args.payload,
            timestamp,
          });

          return id;
        }),

      complete: (id: string): Effect.Effect<void> =>
        Effect.gen(function*() {
          if (id.startsWith('internal_')) return;
          const timestamp = Date.now();

          // 1. Direct update in SurrealDB
          yield* db
            .doc(surrealId('system_executions', id))
            .update()
            .merge({
              status: 'completed',
              endTime: timestamp,
            })
            .toEffect()
            .pipe(
              Effect.catchAllCause((cause) =>
                Effect.logError('[ExecutionTracker] Failed to update execution complete', cause),
              ),
            );

          // 2. Publish to broker
          yield* sendExecutionEvent({ action: 'complete', id, timestamp });
        }),

      fail: (id: string, error: unknown): Effect.Effect<void> =>
        Effect.gen(function*() {
          if (id.startsWith('internal_')) return;
          const timestamp = Date.now();
          const safeError = sanitizeErrorMessage(error);

          // 1. Direct update in SurrealDB with sanitized error string
          yield* db
            .doc(surrealId('system_executions', id))
            .update()
            .merge({
              status: 'failed',
              endTime: timestamp,
              error: safeError,
            })
            .toEffect()
            .pipe(
              Effect.catchAllCause((cause) =>
                Effect.logError('[ExecutionTracker] Failed to update execution fail', cause),
              ),
            );

          // 2. Publish clean failure event to broker
          yield* sendExecutionEvent({ action: 'fail', id, error: safeError, timestamp });
        }),

      getExecutions: (filters: ExecutionFilters): Effect.Effect<readonly ExecutionRecord[], Error> =>
        Effect.suspend(() => {
          const query = db.doc('system_executions').select();

          const whereClause = buildWhere(filters);
          if (Object.keys(whereClause).length > 0) {
            query.where(whereClause);
          }

          return query
            .limit(filters.limit)
            .start(filters.offset)
            .orderBy({ field: 'startTime', direction: 'DESC' })
            .toEffect()
            .pipe(Effect.catchAll(() => Effect.succeed([] as readonly ExecutionRecord[])));
        }),

      countExecutions: (filters: Omit<ExecutionFilters, 'limit' | 'offset'>): Effect.Effect<number, Error> =>
        Effect.suspend(() => {
          const query = db.doc('system_executions').select();

          const whereClause = buildWhere(filters);
          if (Object.keys(whereClause).length > 0) {
            query.where(whereClause);
          }

          return query
            .toEffect()
            .pipe(
              Effect.map((records) => records.length),
              Effect.catchAll(() => Effect.succeed(0)),
            );
        }),

      subscribeExecutions: () => db.doc('system_executions').select().live(),

      subscribeEvents: () =>
        SystemExecutionBroker.subscribe().pipe(
          Stream.provideService(MessageBroker, brokerInstance),
        ),
    };
  }),
}) {}
