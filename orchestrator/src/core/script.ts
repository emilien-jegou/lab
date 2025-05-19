type ScriptFn<In, Out> = (input: In) => Promise<Out> | Out;

export type Script<In = unknown, Out = unknown> = {
  name: string;
  run: (input: In) => Promise<Out>;
};

export const script = <In, Out>(name: string, handler: ScriptFn<In, Out>) => {
  return {
    name,
    async run(input: In) {
      return Promise.resolve(handler(input));
    },
  };
};
