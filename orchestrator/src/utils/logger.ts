import type { ChalkInstance } from 'chalk';
import chalk from 'chalk';
import { createLogUpdate } from 'log-update';
import * as R from 'remeda';
import type { Flow } from '~/core/flow';
import { createAnsiRegex } from './ansi';
import { genRandomAlphaDecimal } from './random';

type Observer<T> = (value: T) => void;

export type Signal<T> = {
  get value(): T;
  set value(value: T);
  subscribe: (observer: Observer<T>) => () => void; // unsubscribe function
};

export const createSignal = <T>(initialValue: T): Signal<T> => {
  let value = initialValue;
  let observers: Observer<T>[] = [];

  const subscribe = (observer: Observer<T>) => {
    observers.push(observer);
    // immediately notify with current value
    observer(value);
    return () => {
      observers = observers.filter((o) => o !== observer);
    };
  };

  return {
    get value() {
      return value;
    },
    set value(newValue: T) {
      if (value === newValue) return;
      value = newValue;
      observers.forEach((observer) => observer(value));
    },
    subscribe,
  };
};

const createLogManager = () => {
  const log = createLogUpdate(process.stdout, {
    showCursor: false,
  });

  return { log, persist: log.done };
};

type ScriptStatus =
  | { kind: 'cancelled' }
  | { kind: 'pending' }
  | { kind: 'ongoing'; last?: string }
  | { kind: 'success' }
  | { kind: 'failure'; error: string };

type Log = {
  kind: 'log' | 'info' | 'warn' | 'debug' | 'error';
  content: string;
};

type ScriptLog<N extends string = string> = {
  name: N;
  logs: Log[];
  status: ScriptStatus;
};

type FlowLog<N extends string = string> = {
  name: string;
  scripts: ScriptLog<N>[];
};

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const spinnerFrameMs = 30;

const getSpinnerFrame = () => {
  const index = Math.floor(Date.now() / spinnerFrameMs) % spinnerFrames.length;
  return spinnerFrames[index];
};

const getStatusIcon = (status: ScriptStatus['kind']) => {
  switch (status) {
    case 'cancelled':
      return '-';
    case 'pending':
      return '○';
    case 'ongoing':
      return getSpinnerFrame();
    case 'success':
      return '✔';
    case 'failure':
      return '❌';
  }
};

const getStatusColor = (status: ScriptStatus['kind']): ChalkInstance => {
  switch (status) {
    case 'cancelled':
      return chalk.grey;
    case 'pending':
      return chalk.grey;
    case 'ongoing':
      return chalk.white;
    case 'success':
      return chalk.green;
    case 'failure':
      return chalk.red;
  }
};

const terminalWidth = process.stdout.columns || 80;

const getLogPrefix = (level: Log['kind']): string =>
  ({
    error: chalk.bold.red('ERROR  '),
    warn: chalk.bold.yellow('WARN   '),
    info: chalk.bold.blue('INFO   '),
    debug: chalk.bold.white('DEBUG  '),
    log: chalk.bold.green('LOG    '),
  })[level];

const formatFlows = (flows: FlowLog[]): string => {
  let buffer = '';
  for (const index in flows) {
    if (Number(index) !== 0) {
      buffer += '\n';
    }
    const flow = flows[index];
    buffer += chalk.blue.bold(`${flow.name}\n`);

    for (const script of flow.scripts) {
      const scriptStatusIcon = getStatusIcon(script.status.kind);
      const c = getStatusColor(script.status.kind);
      buffer += c(`  ${scriptStatusIcon} ${script.name}\n`);
      if (script.status.kind === 'ongoing' && script.status.last?.length) {
        buffer += chalk.grey(`    › ${script.status.last}\n`);
      }

      const printInBox = (
        marginLeft: number,
        border: ChalkInstance,
        logFilter?: (log: Log) => boolean,
      ) => {
        let logBuffer = '';
        logBuffer += border('├' + '─'.repeat(terminalWidth - 4) + '┐\n');
        const pushLine = (log: Log) => {
          logBuffer +=
            border('│') +
            getLogPrefix(log.kind) +
            log.content.padEnd(terminalWidth - 12) +
            border(' │\n');
        };

        script.logs.filter(logFilter ?? (() => true)).forEach(pushLine);

        if (script.status.kind === 'failure') {
          pushLine({ kind: 'error', content: script.status.error });
        }

        logBuffer += border('└' + '─'.repeat(terminalWidth - 4) + '┘\n');
        const splittedBuffer = logBuffer.split('\n');

        if (splittedBuffer.length <= 2) {
          buffer += chalk.grey('  no log');
        } else {
          buffer += splittedBuffer.map((x) => ' '.repeat(marginLeft) + x).join('\n');
        }
      };

      if (script.status.kind === 'failure') {
        printInBox(2, chalk.red);
      } else if (script.logs.find((l) => l.kind === 'warn')) {
        printInBox(2, chalk.yellow, (log) => ['debug', 'warn'].includes(log.kind));
      } else if (script.logs.find((l) => l.kind === 'debug')) {
        printInBox(2, chalk.grey, (log) => ['debug', 'warn'].includes(log.kind));
      }
    }
  }

  return buffer;
};

type FlowLoggerContext = {
  registerFlow(flow: FlowLog): void;
  redraw(): void;
};

const ansiRegex = createAnsiRegex();

const createScriptLogger =
  (ctx: FlowLoggerContext) =>
  <N extends string = string>(script: ScriptLog<N>) => {
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
      if (script.status.kind === 'ongoing') {
        script.status.last = content;
        ctx.redraw();
      }
    };

    const updateStatus = (status: ScriptStatus) => {
      script.status = status;
      ctx.redraw();
    };

    return {
      log: wrapper('log'),
      warn: wrapper('warn'),
      debug: wrapper('debug'),
      error: wrapper('error'),
      info: wrapper('info'),
      updateStatus,
    };
  };

export type ScriptLogger = ReturnType<ReturnType<typeof createScriptLogger>>;

const createFlowLogger =
  (ctx: FlowLoggerContext) =>
  <N extends string = string>(flow: FlowLog<N>) => {
    ctx.registerFlow(flow);
    const scriptLoggerCreator = createScriptLogger(ctx);

    const script = (name: N) => {
      const s = flow.scripts.find((script) => script.name === name);
      if (!s) throw new Error('script not found');
      const logger = scriptLoggerCreator(s);
      return logger;
    };

    return { script };
  };

export type FlowLogger = ReturnType<ReturnType<typeof createFlowLogger>>;
export const flowLogFromFlow = (f: Flow<unknown, unknown>): FlowLog => ({
  name: f.name + ' #' + genRandomAlphaDecimal(8),
  scripts: f.scripts.map((s) => ({
    name: s.name,
    logs: [],
    status: { kind: 'pending' },
  })),
});

export const createOrchestratorLogger = () => {
  const { log, persist } = createLogManager();
  const flows: FlowLog[] = [];

  const registerFlow = (flow: FlowLog) => {
    flows.push(flow);
  };

  let pauseRedraw = false;
  const redraw = () => {
    if (pauseRedraw) return;
    const res = formatFlows(flows);
    log(res);
  };

  setInterval(() => redraw(), spinnerFrameMs);

  setInterval(() => {
    // no point in persisting when screen is not full
    const [left, right] = R.partition(flows, (flow) =>
      flow.scripts.every(({ status }) => status.kind !== 'ongoing'),
    );
    if (left.length === 0) return;
    pauseRedraw = true;
    const res = formatFlows(left);
    log(res);
    persist();
    Object.assign(flows, right);
    flows.splice(0, flows.length, ...right);
    redraw();
    pauseRedraw = false;
  }, 500);

  const flow = createFlowLogger({ registerFlow, redraw });

  return { flow };
};

export type OrchestratorLogger = ReturnType<typeof createOrchestratorLogger>;
