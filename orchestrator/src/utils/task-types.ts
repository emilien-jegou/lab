import type { Flow } from '~/core/flow';
import type { Script } from '~/core/script';

export type TaskLoop = {
  kind: 'loop';
  flow: Flow;
};

export type TaskParallel = {
  kind: 'parallel';
  children: Task[];
};

export type TaskIf = {
  kind: 'if';
  condition: string;
  then: Task[];
  else?: Task[];
};

export type TaskFailureHandler = {
  kind: 'on-failure';
  children: Task[];
};

export type TaskSuccessHandler = {
  kind: 'on-success';
  children: Task[];
};

export type TaskScript = { id: string; kind: 'script'; script: Script };

export type TaskTrigger = { kind: 'trigger'; name: string };

// prettier-ignore
export type Task =
  | TaskScript
  | TaskLoop
  | TaskParallel
  | TaskIf
  | TaskFailureHandler
  | TaskSuccessHandler
  | TaskTrigger;
