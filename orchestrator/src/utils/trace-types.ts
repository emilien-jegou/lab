import { match } from './match';
import type { Task } from './task-types';

export type Script = {
  id: string;
  name: string;
  timeout?: number;
  concurrency?: number;
  ratelimit?: { maxCall: number; windowMs: number };
};

export type ScriptTrace = {
  id: string;
  name: string;

  // options
  //timeout?: number; // in ms
  //concurrency?: number; // number of concurrent scripts allowed
  //ratelimit?: { maxCall: number; windowMs: number };
};

export type TraceLoop = {
  kind: 'loop';
  foreach: string;
  children: TraceTask[];
};

export type TraceParallel = {
  kind: 'parallel';
  children: TraceTask[];
};

export type TraceIf = {
  kind: 'if';
  condition: string;
  then: TraceTask[];
  else?: TraceTask[];
};

export type TraceFailureHandler = {
  kind: 'on-failure';
  children: TraceTask[];
};

export type TraceSuccessHandler = {
  kind: 'on-success';
  children: TraceTask[];
};

export type TraceScript = { kind: 'script' } & ScriptTrace;

export type TraceTriggerWebhook = {
  name: 'webhook';
  data: string; // stringified
  receivedAt: number;
  metadata: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    ip: string;
  };
};

export type TraceTrigger = { kind: 'trigger' } & TraceTriggerWebhook;

// prettier-ignore
export type TraceTask =
  | TraceScript
  | TraceLoop
  | TraceParallel
  | TraceIf
  | TraceFailureHandler
  | TraceSuccessHandler
  | TraceTrigger;

const unimplemented = (): any => {
  throw new Error('unimplemented');
};

export const taskToTrace = (task: Task): TraceTask =>
  match.tag(task, 'kind', {
    loop: ({ flow }) => ({
      kind: 'loop',
      foreach: 'TODO',
      children: flow.tasks.map(taskToTrace),
    }),
    parallel: (_) => unimplemented(),
    if: (_) => unimplemented(),
    'on-failure': (_) => unimplemented(),
    'on-success': (_) => unimplemented(),
    script: ({ id, script }) => ({
      id: id,
      kind: 'script' as const,
      name: script.name,
      status: 'pending',
    }),
    // TODO
    trigger: (value) => value as any,
  });
