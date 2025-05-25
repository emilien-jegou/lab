import { createSeededGenerator, djb2Hash, type IdGenerator } from '~/utils/crypto';
import type { DictSet } from '~/utils/dict';
import type { Task } from '~/utils/task-types';
import type { FlowTracer, ScriptStatus } from '~/utils/tracer';
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

type DifferingKeys<L, R> = {
  [K in keyof L]: K extends keyof R ? (L[K] extends R[K] ? (R[K] extends L[K] ? never : K) : K) : K;
}[keyof L];

export interface Flow<
  In = unknown,
  Out = unknown,
  Ext extends Record<string, unknown> = Record<string, unknown>,
> {
  kind: 'flow';
  name?: string;
  triggers: Trigger<In>[];
  tasks: Task[];
  //function $<T extends R>(ext: T): Script<Out, Next, R, StoreKey>;
  //function $<T>(ext: T): 'Error: Extensions not fulfilled';
  //function $(ext: any);
  idGenerator: IdGenerator;
  $: <Next, StoreKey, R extends Record<never, never>>(
    // TODO: clearer message here
    s: Ext extends R
      ? Script<Out, Next, R, StoreKey>
      : [`Extension does not satisfy requirement on keys :`, DifferingKeys<R, Ext>],
  ) => Flow<In, Next, UpdateStoreExtension<Ext, StoreKey, Next>>;

  run(input: In, logger: FlowTracer): Promise<Out>;
  for<T>(
    arr: (input: ScriptContext<In, Ext>) => T[],
    loopCb: (s: Flow<T, Out, Prettify<DictSet<Ext, 'iter', T>>>) => any,
  ): this;
}

// Result: consistent number
export const flowInner = (
  name: string | undefined,
  store: Record<string, any>,
  triggers: Trigger<any>[],
  idGenerator: IdGenerator,
) => {
  const tasks: Task[] = [];

  const flowChain: Flow = {
    name,
    kind: 'flow',
    idGenerator,
    triggers,
    tasks,
    $: ((s: Script): Flow => {
      tasks.push({ kind: 'script', id: idGenerator(), script: s as unknown as Script });
      return flowChain;
    }) as any,
    for<T>(_arr: (input: any) => T[], loopCb: (s: any) => any) {
      const loopFlow = loopCb(flowInner(undefined, { ...store }, [], idGenerator));
      tasks.push({ kind: 'loop', flow: loopFlow });
      return this;
    },
    run: createRunner<any>(tasks, { store, iter: undefined }),
  };

  return flowChain;
};

export const flow = (name: string) => ({
  trigger: <In extends object>(trigger: Trigger<In>): Flow<In, In, { trigger: In }> => {
    const idGenerator = createSeededGenerator(djb2Hash(name));
    return flowInner(name, {}, [trigger], idGenerator) as any;
  },
});

const createRunner =
  <In extends object>(tasks: Task[], ctx: Record<string, any>) =>
  async (value: In, flowTracer: FlowTracer) => {
    let current: any = value;
    let cancelledAt: number | undefined = undefined;
    let finalStatus: ScriptStatus['kind'] = 'success';
    const cancel = () => {
      cancelledAt = Date.now();
      finalStatus = 'cancelled';
    };

    await flowTracer.updateStatus('ongoing');

    for (const currentTask of tasks) {
      switch (currentTask.kind) {
        case 'script': {
          const currentScript = currentTask.script;
          const scriptTracer = await flowTracer.script({
            id: currentTask.id,
            name: currentScript.name,
          });
          const scriptLogger = scriptTracer.logger();

          if (cancelledAt) {
            scriptTracer.updateStatus({ kind: 'cancelled', cancelledAt: cancelledAt });
            continue;
          }

          const startedAt = Date.now();
          try {
            scriptTracer.updateStatus({ kind: 'ongoing', startedAt });

            current = await Promise.resolve(
              currentScript.run(
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

            const completedAt = Date.now();

            if (cancelledAt) {
              scriptTracer.updateStatus({ kind: 'cancelled', startedAt, cancelledAt: Date.now() });
              continue;
            }

            if (currentScript._store !== undefined) {
              ctx['store'][currentScript._store] = current;
              await scriptTracer.setStore(currentScript._store, current);
            }

            scriptTracer.updateStatus({
              kind: 'success',
              startedAt,
              completedAt,
              data: JSON.stringify(current),
            });
          } catch (e: unknown) {
            const completedAt = Date.now();
            scriptTracer.updateStatus({
              kind: 'failure',
              startedAt,
              completedAt: Date.now(),
              error: String(e),
            });
            finalStatus = 'failure';
            cancelledAt = completedAt;
          }
          break;
        }
        case 'loop': {
          currentTask.flow.run(current, flowTracer);
          console.info(currentTask);
          break;
        }
      }
    }

    await flowTracer.updateStatus(finalStatus);

    return current as any;
  };
