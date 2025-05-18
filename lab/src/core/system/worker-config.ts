// Worker context service exposing the current worker's identity and subscriptions.
import { Context } from 'effect';

export interface IWorkerConfig {
  readonly workerId: string;
  readonly subscribedGroups: string[];
  readonly currentTaskGroup: string;
}

export class WorkerConfig extends Context.Tag('system/WorkerConfig')<
  WorkerConfig,
  IWorkerConfig
>() { }
