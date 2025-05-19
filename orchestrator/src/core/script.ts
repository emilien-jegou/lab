import type { ScriptLogger } from '~/utils/logger';

export type ScriptContext = {
  logger: ScriptLogger;
  cancel: () => void;
};

type ScriptFn<In, Out> = (input: In, ctx: ScriptContext) => Promise<Out> | Out;

export type Script<In = unknown, Out = unknown> = {
  name: string;
  run: (input: In, logger: ScriptContext) => Promise<Out>;
};

export const script = <In, Out>(name: string, handler: ScriptFn<In, Out>) => {
  return {
    name,
    run: (input: In, ctx: ScriptContext) => Promise.resolve(handler(input, ctx)),
  };
};
