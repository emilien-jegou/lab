import type { DictSet } from '~/utils/dict';
import type { FlowTracer } from '~/utils/tracer';
import type { Script, ScriptContext } from './script';
import type { Trigger } from './trigger';

export type Prettify<T> = { [K in keyof T]: T[K] } & {};
type UpdateStoreExtension<Ext extends Record<string, any>, StoreKey, Out> = Prettify<
  DictSet<
    Ext,
    'store',
    StoreKey extends string ? DictSet<Ext['store'], StoreKey, Out> : Ext['store']
  >
>;

export interface Flow<
  In = unknown,
  Out = unknown,
  Ext extends Record<string, unknown> = Record<string, unknown>,
> {
  kind: 'flow';
  name: string;
  triggers: Trigger<In>[];
  tree: (Script | Flow<any, any, any>)[];
  //function $<T extends R>(ext: T): Script<Out, Next, R, StoreKey>;
  //function $<T>(ext: T): 'Error: Extensions not fulfilled';
  //function $(ext: any);
  $: <Next, StoreKey, R extends Record<never, never>>(
    // TODO: clearer message here
    s: Ext extends R
      ? Script<Out, Next, R, StoreKey>
      : [`Extension does not satisfy requirement`, Ext],
  ) => Flow<In, Next, UpdateStoreExtension<Ext, StoreKey, Next>>;

  run(input: In, logger: FlowTracer): Promise<Out>;
  for<T>(
    arr: (input: ScriptContext<In, Ext>) => T[],
    loopCb: (s: Flow<T, Out, Prettify<DictSet<Ext, 'iter', T>>>) => any,
  ): this;
}

export const flow = (name: string) => {
  const triggers: Trigger<any>[] = [];
  const scripts: (Script | Flow<any, any, any>)[] = [];
  const store: Record<string, any> = {};

  return {
    trigger: <In extends object>(trigger: Trigger<In>): Flow<In, In, { trigger: In }> => {
      triggers.push(trigger);
      const flowChain: Flow<In, In, { trigger: In }> = {
        name,
        kind: 'flow',
        triggers,
        tree: scripts,
        $: (<Next>(s: Script<In, Next, any, In>): Flow<In, Next, any> => {
          scripts.push(s as unknown as Script);
          return flowChain as unknown as Flow<In, Next, { trigger: In }>;
        }) as unknown as any,
        run: createRunner<In>(scripts, { store, iter: undefined }),
        for<T>(_arr: (input: any) => T[], _loopCb: (s: any) => any) {
          return this;
        },
      };

      return flowChain;
    },
  };
};

const createRunner =
  <In extends object>(tasks: (Script | Flow)[], ctx: Record<string, any>) =>
  async (value: In, tracer: FlowTracer) => {
    let current: any = value;
    let errorEncountered = false;
    let cancelled = false;

    const cancel = () => (cancelled = true);

    for (const currentTask of tasks) {
      switch (currentTask.kind) {
        case 'script': {
          const scriptTracer = await tracer.script(currentTask.name);
          const scriptLogger = scriptTracer.logger();

          if (cancelled || errorEncountered) {
            scriptTracer.updateStatus({ kind: 'cancelled' });
            continue;
          }

          try {
            scriptTracer.updateStatus({ kind: 'ongoing' });
            current = await Promise.resolve(
              currentTask.run(
                {
                  ...ctx,
                  prev: current,
                  trigger: value,
                } as any,
                {
                  logger: scriptLogger,
                  cancel,
                },
              ),
            );

            if (cancelled) {
              scriptTracer.updateStatus({ kind: 'cancelled' });
              continue;
            }

            if (currentTask._store !== undefined) {
              ctx['store'][currentTask._store] = current;
            }

            scriptTracer.updateStatus({ kind: 'success', data: JSON.stringify(current) });
          } catch (e: unknown) {
            scriptTracer.updateStatus({ kind: 'failure', error: String(e) });
            errorEncountered = true;
          }
          break;
        }
        case 'flow': {
          break;
        }
      }
    }

    return current as any;
  };
