// Shared job descriptor passed from triggers to workers.
import type { Context, Schema } from 'effect';
import type { TriggerHandler } from '../triggers/base';

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
