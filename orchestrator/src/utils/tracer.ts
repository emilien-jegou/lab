import type { RedisClient } from 'bun';
import { nanoid } from 'nanoid';
import type { Flow } from '~/core/flow';
import { createAnsiRegex } from './ansi';
import { createRedisStorage } from './storage';

type Log = {
  kind: 'log' | 'info' | 'warn' | 'debug' | 'error';
  content: string;
};

type ScriptStatus =
  | { kind: 'cancelled' }
  | { kind: 'pending' }
  | { kind: 'ongoing' }
  | { kind: 'success'; data: string /* stringified */ }
  | { kind: 'failure'; error: string };

type ScriptTrace = {
  id: string;
  name: string;

  // options
  timeout?: number; // in ms
  concurrency?: number; // number of concurrent scripts allowed
  ratelimit?: { maxCall: number; windowMs: number };
};

type TriggerTrace = {
  kind: 'webhook';
  data: string; // stringified
};

type ScriptEntity = {
  id: string;
  name: string;
  logs: Log[];
  status: ScriptStatus;

  store?: { key: string; value: string };
};

type TaskTrace =
  | ({ kind: 'script' } & ScriptTrace)
  | { kind: 'loop'; iterations: { input: string; flow: FlowEntity }[] };

export type FlowEntity = {
  id: string;
  name: string;
  triggeredBy: TriggerTrace;
  tasks: TaskTrace[];
  status: ScriptStatus['kind'];
};

const ansiRegex = createAnsiRegex();

export type Logger = Record<Log['kind'], (args: any) => void>;

export const getScriptStorage = (client: RedisClient, flowId: string) =>
  createRedisStorage<ScriptEntity>(client, ['flow', flowId, 'script']);

const createScriptTracer = async (client: RedisClient, flow: FlowEntity, script: ScriptTrace) => {
  const scriptStorage = getScriptStorage(client, flow.id);
  const scriptEntity: ScriptEntity = {
    id: script.id,
    name: script.name,
    logs: [],
    status: { kind: 'pending' },
  };

  await scriptStorage.set(scriptEntity);

  const wrapper = (kind: Log['kind']) => (toprint: any) => {
    let content = '';
    if (typeof toprint !== 'string') {
      try {
        content = JSON.stringify(toprint, null, '');
      } catch (_) {
        content = String(toprint);
      }
    } else {
      content = toprint;
    }
    scriptEntity.logs.push({ kind, content: content.replace(ansiRegex, '') });
    scriptStorage.update(scriptEntity);
  };

  const updateStatus = (status: ScriptStatus) => {
    scriptEntity.status = status;
    scriptStorage.update(scriptEntity);
  };

  const setStore = (key: string, value: string) => {
    scriptEntity.store = { key, value };
    scriptStorage.update(scriptEntity);
  };

  //const updateOptions = (
  //  options: Partial<Pick<ScriptTrace, 'timeout' | 'concurrency' | 'ratelimit'>>,
  //) => {
  //  Object.assign(script, options);
  //};

  return {
    logger: (): Logger => ({
      log: wrapper('log'),
      warn: wrapper('warn'),
      debug: wrapper('debug'),
      error: wrapper('error'),
      info: wrapper('info'),
    }),
    updateStatus,
    setStore,
    // updateOptions,
  };
};

export type ScriptTracer = UnwrapPromise<ReturnType<typeof createScriptTracer>>;

export const getFlowStorage = (client: RedisClient) =>
  createRedisStorage<FlowEntity>(client, ['flow']);

export const flowTraceFromFlow = (f: Flow, trigger: TriggerTrace): FlowEntity => ({
  id: nanoid(),
  name: f.name,
  triggeredBy: trigger,
  tasks: f.tree.map((s) => ({
    kind: 'script' as const,
    id: nanoid(),
    name: s.name,
  })),
  status: 'pending',
});

export const createFlowTracer = async (client: RedisClient, flow: Flow, trigger: TriggerTrace) => {
  const flowTrace = flowTraceFromFlow(flow, trigger);
  const flowStorage = getFlowStorage(client);

  await flowStorage.set(flowTrace);

  const script = (name: string) => {
    const task = flowTrace.tasks.find((task) => task.kind === 'script' && task.name === name);

    if (!task || task.kind !== 'script') throw new Error(`script '${name}' not found`);
    return createScriptTracer(client, flowTrace, task);
  };

  //const addLoopIteration = (input: string, iterationFlow: FlowTrace) => {
  //  const loopTask = flowTrace.tasks.find((task) => task.kind === 'loop') as
  //    | { kind: 'loop'; iterations: { input: string; flow: FlowTrace }[] }
  //    | undefined;

  //  if (loopTask) {
  //    loopTask.iterations.push({ input, flow: iterationFlow });
  //  }
  //};

  const updateTrigger = (trigger: TriggerTrace) => {
    flowTrace.triggeredBy = trigger;
    flowStorage.update(flowTrace);
  };

  return {
    trace: flowTrace,
    script,
    //addLoopIteration,
    updateTrigger,
  };
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

export type FlowTracer = UnwrapPromise<ReturnType<typeof createFlowTracer>>;
