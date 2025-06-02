import type { RedisClient } from 'bun';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';
import { z, ZodError } from 'zod';
import { addRoute } from '~/utils/server';
import { createFlowTracer } from '~/utils/tracer';
import type { Flow } from '../core/flow';
import type { Trigger } from '../core/trigger';

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

type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type WebhookTriggerOptions = {
  method?: WebhookMethod;
  token?: string;
};

const createRegister =
  <S extends ZodSchema>(path: string, method: WebhookMethod, schema: S) =>
  async <Out>(flow: Flow<InferType<S>, Out>, client: RedisClient) => {
    addRoute(method, path, async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const receivedAt = Date.now();
        const result = schema.parse(request.body) as InferType<S>;
        const flowTracer = await createFlowTracer(client, flow, {
          kind: 'webhook',
          data: JSON.stringify(result),
          receivedAt,
          metadata: {
            method: request.method,
            url: request.url,
            headers: request.headers,
            ip: request.ip,
          },
        });

        flow.run(result, flowTracer);
      } catch (err) {
        if (err instanceof ZodError) {
          reply.status(400).send({
            error: 'Validation failed',
            issues: err.errors,
          });
        } else {
          reply.status(500).send({ error: 'Internal server error' });
        }
        throw err;
      }
    });
  };

export const webhookTrigger = (
  path: string,
  options: WebhookTriggerOptions = {},
): TriggerBuilder => {
  const method = options.method ?? 'POST';

  return {
    schema<S extends ZodSchema>(schema: S): TriggerBuilderWithSchema<S> {
      return {
        schema,
        build: () => ({
          type: 'webhook',
          schema,
          register: createRegister(path, method, schema),
        }),
      };
    },

    build: () => ({
      type: 'webhook',
      schema: z.unknown(),
      register: createRegister(path, method, z.unknown()),
    }),
  };
};
