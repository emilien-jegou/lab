import type { FlowLogger } from '~/utils/logger';
import type { Script, ScriptContext } from './script';
import type { Trigger } from './trigger';

export interface Flow<In, Out, Store extends object = object> {
  kind: 'flow';
  name: string;
  triggers: Trigger<In>[];
  scripts: Script[];
  $: <Next, StoreKey>(
    s: Script<Out, Next, Store, In, StoreKey>,
  ) => Flow<In, Next, StoreKey extends string ? Store & Record<StoreKey, Next> : Store>;
  run(input: In, logger: FlowLogger): Promise<Out>;
  for<T>(arr: (input: ScriptContext<In, Store, In>) => T[], loopCb: (s: any) => any): this;
}

export const flow = (name: string) => {
  const triggers: Trigger<any>[] = [];
  const scripts: Script[] = [];
  const store: Record<string, any> = {};

  return {
    trigger: <In extends object>(trigger: Trigger<In>): Flow<In, In> => {
      triggers.push(trigger);

      const flowChain: Flow<In, In> = {
        name,
        kind: 'flow',
        triggers,
        scripts,
        $: (<Next>(s: Script<In, Next, any, In>): Flow<In, Next, any> => {
          scripts.push(s as unknown as Script);
          return flowChain as unknown as Flow<In, Next>;
        }) as unknown as any,
        run: createRunner<In>(scripts, store),
        for<T>(arr: (input: ScriptContext<In, Store, In>) => T[], loopCb: (s: any) => any) {
          return this;
        },
      };

      return flowChain;
    },
  };
};

const createRunner =
  <In extends object>(scripts: Script[], store: Record<string, any>) =>
  async (value: In, logger: FlowLogger) => {
    let current: any = value;
    let errorEncountered = false;
    let cancelled = false;

    const cancel = () => (cancelled = true);

    for (const currentScript of scripts) {
      const scriptLogger = logger.script(currentScript.name);

      if (cancelled || errorEncountered) {
        scriptLogger.updateStatus({ kind: 'cancelled' });
        continue;
      }

      try {
        scriptLogger.updateStatus({ kind: 'ongoing' });
        current = await Promise.resolve(
          currentScript.run({
            prev: current,
            trigger: value,
            store: { ...store },
            logger: scriptLogger,
            cancel,
          }),
        );

        if (cancelled) {
          scriptLogger.updateStatus({ kind: 'cancelled' });
          continue;
        }

        if (currentScript._store !== undefined) {
          store[currentScript._store] = current;
        }

        scriptLogger.updateStatus({ kind: 'success' });
      } catch (e: unknown) {
        scriptLogger.updateStatus({ kind: 'failure', error: String(e) });
        errorEncountered = true;
      }
    }

    return current as any;
  };
