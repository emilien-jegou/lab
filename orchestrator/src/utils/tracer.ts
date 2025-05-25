import { sleep } from 'bun';
import type { Flow } from '~/core/flow';
import type { Script } from '~/core/script';
import { createAnsiRegex } from './ansi';
import { generateId } from './crypto';
import type { StorageClient } from './storage';
import { createRedisStorage } from './storage';
import type { ScriptTrace, TraceTriggerWebhook, TraceTask } from './trace-types';
import { taskToTrace } from './trace-types';

export type Log = {
  kind: 'log' | 'info' | 'warn' | 'debug' | 'error';
  content: string;
  timestamp: number;
};

export type ScriptStatus =
  | { kind: 'cancelled'; startedAt?: number; cancelledAt: number }
  | { kind: 'pending' }
  | { kind: 'ongoing'; startedAt: number }
  | { kind: 'success'; startedAt: number; completedAt: number; data: string /* stringified */ }
  | { kind: 'failure'; startedAt: number; completedAt: number; error: string };

export type ScriptEntity = {
  id: string;
  name: string;
  logs: Log[];
  status: ScriptStatus;
  createdAt: number;

  store?: { key: string; value: string };
};

export type FlowEntity = {
  id: string;
  name: string;
  trigger: TraceTriggerWebhook;
  tasks: TraceTask[];
  status: ScriptStatus['kind'];
};

const ansiRegex = createAnsiRegex();

export type Logger = Record<Log['kind'], (args: any) => void>;

export const getScriptStorage = (client: StorageClient, flowId: string) =>
  createRedisStorage<ScriptEntity>(client, ['flow', flowId, 'script']);

const createScriptTracer = async (
  client: StorageClient,
  flow: FlowEntity,
  script: ScriptTrace,
  flowUpdateTaskStatus: (status: ScriptStatus['kind']) => Promise<void>,
) => {
  const scriptStorage = getScriptStorage(client, flow.id);
  const logs: Log[] = [];

  await scriptStorage.set({
    id: script.id,
    name: script.name,
    logs: [],
    status: { kind: 'pending' },
    createdAt: Date.now(),
  } satisfies ScriptEntity);

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
    logs.push({
      kind,
      content: content.replace(ansiRegex, ''),
      timestamp: Date.now(),
    });
    scriptStorage.mergeDeep(script.id, 'logs', logs);
  };

  const updateStatus = async (status: ScriptStatus) => {
    await scriptStorage.mergeDeep(script.id, 'status', status);
    await flowUpdateTaskStatus(status.kind);
  };

  const setStore = async (key: string, value: string) => {
    await scriptStorage.mergeDeep(script.id, 'store', { key, value });
  };

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
  };
};

export type ScriptTracer = UnwrapPromise<ReturnType<typeof createScriptTracer>>;

export const getFlowStorage = (client: StorageClient) =>
  createRedisStorage<FlowEntity>(client, ['flow']);

export const createFlowEntity = (f: Flow, trigger: TraceTriggerWebhook): FlowEntity => ({
  id: generateId(),
  name: f.name!,
  trigger: trigger,
  tasks: f.tasks.map(taskToTrace),
  status: 'pending',
});

export const createFlowTracer = async (
  client: StorageClient,
  flow: Flow,
  trigger: TraceTriggerWebhook,
) => {
  const flowEntity = createFlowEntity(flow, trigger);
  const flowStorage = getFlowStorage(client);

  await flowStorage.set(flowEntity);

  // orderIdx is used to differentiate scripts with
  // the same name amongst a flow
  const script = (script: ScriptTrace) => {
    const flowUpdateTaskStatus = async (_status: ScriptStatus['kind']) => {
      // await flowStorage.mergeDeep(flowEntity.id, `tasks.${orderIdx}.status` as any, status);
    };
    return createScriptTracer(client, flowEntity, script, flowUpdateTaskStatus);
  };

  const updateTrigger = async (trigger: TraceTriggerWebhook) => {
    flowEntity.trigger = trigger;
    await flowStorage.mergeDeep(flowEntity.id, 'trigger', trigger);
  };

  const updateStatus = async (newStatus: ScriptStatus['kind']) => {
    await sleep(20);
    await flowStorage.mergeDeep(flowEntity.id, 'status', newStatus);
  };

  const self = {
    trace: flowEntity,
    script,
    //addLoopIteration,
    updateTrigger,
    updateStatus,
  };
  return self;
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

export type FlowTracer = UnwrapPromise<ReturnType<typeof createFlowTracer>>;
