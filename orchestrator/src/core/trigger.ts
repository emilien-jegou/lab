import type { RedisClient } from 'bun';
import type { z } from 'zod';
import type { Flow } from './flow';

export type ZodSchema = z.ZodType<any, any, any>;

export type Trigger<T> = {
  type: string;
  schema: ZodSchema;
  register: <Out>(flow: Flow<T, Out, any>, client: RedisClient) => void;
};
