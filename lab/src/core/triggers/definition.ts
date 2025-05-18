// Trigger descriptor: immutable metadata, schema, and producer (no wiring).
import { Effect, Schema } from 'effect';

import type { TriggerQueue } from './queue';

export interface TriggerDefinition<Payload, E, R> {
  readonly _tag: string;
  readonly meta: Record<string, unknown>;
  readonly payloadSchema: Schema.Schema<Payload, any, any>;
  readonly producer: Effect.Effect<void, E, R | TriggerQueue>;
  readonly triggerName?: string;
  readonly triggerDescription?: string;
  readonly targetGroup: string;

  readonly name: (name: string) => TriggerDefinition<Payload, E, R>;
  readonly describe: (description: string) => TriggerDefinition<Payload, E, R>;
  readonly workerGroup: (group: string) => TriggerDefinition<Payload, E, R>;
}

export const make = <Payload, E, R>(
  _tag: string,
  meta: Record<string, unknown>,
  payloadSchema: Schema.Schema<Payload, any, any>,
  producer: Effect.Effect<void, E, R | TriggerQueue>,
  triggerName?: string,
  triggerDescription?: string,
  targetGroup: string = 'default',
): TriggerDefinition<Payload, E, R> => ({
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
});
