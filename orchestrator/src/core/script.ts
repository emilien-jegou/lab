import type { ScriptLogger } from '~/utils/logger';
import { createTaskObservable, type TaskMessage } from './worker';

export type ScriptContext<In, Store, Trigger> = {
  prev: In;
  store: Store;
  trigger: Trigger;
  cancel: (reason?: string) => void;
};

type ScriptFn<In, Out, Store, Trigger> = (
  ctx: ScriptContext<In, Store, Trigger>,
) => Promise<Out> | Out;

type OutterContext<In, Store, Trigger> = ScriptContext<In, Store, Trigger> & {
  logger: ScriptLogger;
};

export interface Script<
  In = unknown,
  Out = unknown,
  Store = Record<never, never>,
  Trigger = Record<never, never>,
  StoreKey = undefined,
> {
  _store?: StoreKey;
  name: string;
  store<const S extends string>(storeName: S): Script<In, Out, Store, Trigger, S>;
  run(outerContext: OutterContext<In, Store, Trigger>): Promise<Out>;

  // .cache('brandSearch', { ttl: '1h' })
  // .validate((i) => i.webSearch.searches.length > 0)
  // .onError('retry', { maxAttempts: 3 })
  // .onError('skip')
  // .onError('fail')
  // .branch((i) => i.webSearch.searches.length > 10, left, right)
  //
  // .switch((i) => i.brand.category, {
  //   'luxury': [luxuryBrandTasks],
  //   'streetwear': [streetwearTasks],
  //   'default': [genericTasks]
  // })
  //
  // .transform((i) => ({ ...i.prev, normalized: normalizeUrl(i.prev.url) }))
  // .filter((i) => i.webSearch.searches, (search) => search.score > 0.8)
  // .map((i) => i.searches, (search) => ({ ...search, processed: true }))
  // .tap((i) => ...)
  // .reduce((i) => i.searches, (acc, search) => acc + search.score, 0)
  // .validate((i) => i.bestFit.confidence > 0.7, 'Low confidence result')
  //
  // .subflow(brandValidationFlow) // compose other flows
  // .mixin(auditingMixin) // add cross-cutting concerns
  // .template('brandProcessor', { searchEngine: 'google' }) // parameterized flows
  // .extend(baseFlow) // inheritance-like behavior
  // .delay('5s') // add delays between steps
  //
  // .skipIf((i) => isWeekend()) // time-based conditions
  // .retryIf((i) => isTransientError(i.error))
  // .continueIf((i) => i.confidence > 0.5, 'low_confidence_path')
  // .requireAll(['webSearch', 'bestFit']) // dependency requirements
  // .requireAny(['primarySource', 'fallbackSource']) // alternative requirements
  //
  // .rateLimit(maxCall: number, windowMs: number): this;
  // .timeout(ms: number): this;
  // .concurrency(count: number): this;
}

const getCalleeLocation = (stack: string) => {
  const lines = stack.split('\n');

  // Find the first line that matches the pattern **/src/scripts/*.ts
  const scriptsLine = lines.find((line) => /\/src\/scripts\/.*\.ts/.test(line));

  if (!scriptsLine) {
    throw new Error("Couldn't find script path, make sure it is under the scripts directory");
  }
  const match = scriptsLine.match(/at\s+(.+):(\d+):(\d+)/);
  if (!match) {
    throw new Error("Couldn't find script path, make sure it is under the scripts directory");
  }
  return match[1];
};

const formatOutput = (args: any[]) =>
  args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');

const overwriteConsole = (interceptor: (s: TaskMessage<any, any>) => void) => {
  console.log = (...args: any[]) => {
    interceptor({
      kind: 'console',
      logType: 'log',
      message: formatOutput(args),
    });
  };

  console.error = (...args: any[]) => {
    interceptor({
      kind: 'console',
      logType: 'error',
      message: formatOutput(args),
    });
  };

  console.warn = (...args: any[]) => {
    interceptor({
      kind: 'console',
      logType: 'warn',
      message: formatOutput(args),
    });
  };

  console.info = (...args: any[]) => {
    interceptor({
      kind: 'console',
      logType: 'info',
      message: formatOutput(args),
    });
  };

  console.debug = (...args: any[]) => {
    interceptor({
      kind: 'console',
      logType: 'debug',
      message: formatOutput(args),
    });
  };

  console.trace = (...args: any[]) => {
    interceptor({
      kind: 'console',
      logType: 'debug',
      message: formatOutput(args) + (new Error().stack ?? ''),
    });
  };
};

export const script = <In, Out, Store = Record<never, never>, Trigger = object>(
  name: string,
  handler: ScriptFn<In, Out, Store, Trigger>,
): Script<In, Out, Store, Trigger> => {
  const loc = getCalleeLocation(new Error().stack!);
  self.onmessage = (event: MessageEvent<{ prev: In; store: Store; trigger: Trigger }>) => {
    if ((event as any).data === 'ping') {
      return void self.postMessage('pong');
    }

    overwriteConsole((m) => {
      self.postMessage(m);
    });

    let isCancelled = false;
    const cancel = (reason?: string) => {
      isCancelled = true;
      self.postMessage({ kind: 'cancelled', reason, completedat: Date.now() });
    };

    Promise.resolve(
      handler({
        prev: event.data.prev,
        store: event.data.store,
        trigger: event.data.trigger,
        cancel,
      }),
    )
      .then((result) => {
        if (isCancelled) return;
        const response: TaskMessage<In, Store> = {
          result: JSON.stringify(result),
          kind: 'success',
          completedAt: Date.now(),
        };

        try {
          self.postMessage({ ...response });
        } catch (err) {
          console.error("Couldn't post response after script success");
          throw err;
        }
      })
      .catch((err: any) => {
        const errorResponse: TaskMessage<In, Store> = {
          kind: 'failure',
          error: JSON.stringify(err + '\n' + err.stack),
          completedAt: Date.now(),
        };

        try {
          self.postMessage(errorResponse);
        } catch (err) {
          console.error("Couldn't post response after script failure");
          throw err;
        }
      });
  };

  const taskObservable = createTaskObservable<In, Store, Trigger>(loc);

  return {
    name,
    _store: undefined,
    // see definition above
    store(storeName: any): any {
      this._store = storeName as any;
      return this as any;
    },

    run: (ctx: OutterContext<In, Store, Trigger>) =>
      new Promise((res, rej) => {
        const subscriber = taskObservable.subscribe({
          next: (data: TaskMessage<In, Store>) => {
            switch (data.kind) {
              case 'ready':
                data.send({ prev: ctx.prev, store: ctx.store });
                return;
              case 'console':
                ctx.logger[data.logType](data.message);
                return;
              case 'success': {
                ctx.logger.log(`Task finished at ${data.completedAt}`);
                const parsed = JSON.parse(data.result);
                res(parsed);
                subscriber.unsubscribe();
                return;
              }
              case 'cancelled': {
                ctx.logger.log(`Task cancelled at ${data.completedAt}`);
                if (data.reason) {
                  ctx.logger.log(`Cancel reason: ${data.reason}`);
                }
                ctx.cancel();
                res(undefined as any);
                subscriber.unsubscribe();
                return;
              }
              case 'failure': {
                ctx.logger.log(`Task failed at ${data.completedAt}`);

                const parsedError = JSON.parse(data.error);
                rej(parsedError);
                subscriber.unsubscribe();
                return;
              }
            }
          },
          error: (err) => {
            ctx.logger.error(err);
            rej(err);
            subscriber.unsubscribe();
          },
        });
      }),
  };
};
