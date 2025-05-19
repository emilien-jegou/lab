import type { z } from 'zod';
import type { OrchestratorLogger } from '../utils/logger';
import type { Flow } from './flow';

export type ZodSchema = z.ZodType<any, any, any>;

export type Trigger<T> = {
  type: string;
  schema: ZodSchema;
  register: <Out>(flow: Flow<T, Out>, logger: OrchestratorLogger) => void;
};
