import type { Flow } from '~/core/flow';
import { createAnsiRegex } from './ansi';
import { genRandomAlphaDecimal } from './random';

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

type ScriptTrace<N extends string = string> = {
  name: N;
  logs: Log[];
  status: ScriptStatus;

  // options
  store?: { key: string; value: string };
  timeout?: number; // in ms
  concurrency?: number; // number of concurrent scripts allowed
  ratelimit?: { maxCall: number; windowMs: number };
};

type TriggerTrace = {
  kind: 'webhook';
  data: string; // stringified
};

type TaskTrace =
  | { kind: 'script'; data: ScriptTrace }
  | { kind: 'loop'; iterations: { input: string; flow: FlowTrace }[] };

type FlowTrace = {
  name: string;
  triggeredBy: TriggerTrace;
  tasks: TaskTrace[];
};

const ansiRegex = createAnsiRegex();

export type Logger = Record<Log['kind'], (args: any) => void>;

const createScriptTracer = <N extends string = string>(script: ScriptTrace<N>) => {
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
    script.logs.push({ kind, content: content.replace(ansiRegex, '') });
  };

  const updateStatus = (status: ScriptStatus) => {
    script.status = status;
  };

  const setStore = (key: string, value: string) => {
    script.store = { key, value };
  };

  const updateOptions = (
    options: Partial<Pick<ScriptTrace<N>, 'timeout' | 'concurrency' | 'ratelimit'>>,
  ) => {
    Object.assign(script, options);
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
    updateOptions,
  };
};

export type ScriptTracer = ReturnType<typeof createScriptTracer>;

export const createFlowTracer = <N extends string = string>(flow: Flow) => {
  const flowTrace = flowTraceFromFlow(flow);

  const script = (name: N) => {
    const task = flowTrace.tasks.find(
      (task) => task.kind === 'script' && task.data.name === name,
    ) as { kind: 'script'; data: ScriptTrace<N> } | undefined;

    if (!task) throw new Error(`script '${name}' not found`);
    return createScriptTracer(task.data);
  };

  const addLoopIteration = (input: string, iterationFlow: FlowTrace) => {
    const loopTask = flowTrace.tasks.find((task) => task.kind === 'loop') as
      | { kind: 'loop'; iterations: { input: string; flow: FlowTrace }[] }
      | undefined;

    if (loopTask) {
      loopTask.iterations.push({ input, flow: iterationFlow });
    }
  };

  const updateTrigger = (trigger: TriggerTrace) => {
    flowTrace.triggeredBy = trigger;
  };

  return {
    trace: flowTrace,
    script,
    addLoopIteration,
    updateTrigger,
  };
};

export type FlowTracer = ReturnType<typeof createFlowTracer>;

export const flowTraceFromFlow = (f: Flow, triggeredBy: TriggerTrace): FlowTrace => ({
  name: f.name + ' #' + genRandomAlphaDecimal(8),
  triggeredBy,
  tasks: f.tree.map((s) => ({
    kind: 'script' as const,
    data: {
      name: s.name,
      logs: [],
      status: { kind: 'pending' as const },
    },
  })),
});

export const createAppTracer = () => {
  const flows: FlowTrace[] = [];

  const addFlowTracer = (flow: FlowTracer) => {
    flows.push(flow.trace);
  };

  return { addFlowTracer };
};

export type AppTracer = ReturnType<typeof createAppTracer>;
