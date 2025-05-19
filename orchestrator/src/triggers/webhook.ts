import type { ZodSchema } from 'zod';
import { z } from 'zod';
import type { Flow } from '../core/flow';
import type { Trigger } from '../core/trigger';
import type { FlowLogger } from '../utils/logger';
import { addRoute } from '../utils/server';

// Define the types with Zod schema inference
type InferType<S extends ZodSchema> = z.infer<S>;

interface TriggerBuilderWithSchema<S extends ZodSchema> {
  schema: S;
  build: () => Trigger<InferType<S>>;
}

interface TriggerBuilder {
  schema: <S extends ZodSchema>(schema: S) => TriggerBuilderWithSchema<S>;
  build: () => Trigger<unknown>;
}

type WebhookTriggerOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  token?: string;
};

export const webhookTrigger = (
  path: string,
  options: WebhookTriggerOptions = {},
): TriggerBuilder => {
  const method = options.method ?? 'GET';

  return {
    schema<S extends ZodSchema>(schema: S): TriggerBuilderWithSchema<S> {
      return {
        schema,
        build: () => ({
          type: 'webhook',
          schema,

          register: async <Out>(flow: Flow<unknown, Out>, logger: FlowLogger) => {
            addRoute(method, path, async () => {
              console.log('123');
            });
          },
        }),
      };
    },

    build: () => ({
      type: 'webhook',
      schema: z.unknown(),
      register: async () => {
        addRoute(method, path, async () => {
          console.log('456');
        });
      },
    }),
  };
};
