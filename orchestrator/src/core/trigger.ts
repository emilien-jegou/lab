import type { z } from 'zod';
import type { StorageClient } from '~/utils/storage';
import type { Flow } from './flow';

export type ZodSchema = z.ZodType<any, any, any>;

export type Trigger<T> = {
  type: string;
  schema: ZodSchema;
  register: <Out>(flow: Flow<T, Out, any>, client: StorageClient) => void;
};
