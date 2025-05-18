// Execution tracking schemas, event broker, and database document definitions.
import { Schema } from 'effect';

import { document } from '~/services/surrealdb/api';
import { dbschema } from '~/services/surrealdb/api-builder';

import { defineBroker } from '../broker';

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
