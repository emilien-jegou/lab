// infra/src/internal/script/Script.ts
import * as Crypto from "node:crypto";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface ScriptRunOptions<TParams = unknown, TOutput = unknown> {
  /** Optional parameters passed into the script function. */
  readonly params?: TParams;
  /** The TypeScript function to execute. Can be sync, a Promise, or an Effect. */
  readonly run: (
    params: TParams,
  ) => Promise<TOutput> | TOutput | Effect.Effect<TOutput, any, any>;
}

export interface ScriptProps<TParams = unknown, TOutput = unknown> {
  readonly params?: TParams;
  readonly triggers?: unknown[];
  /**
   * Bump this to force a re-run when the `run` body's logic changes but its
   * declared `params`/`triggers` do not. Identity is derived from declared
   * inputs only — editing the closure source no longer silently retriggers every
   * downstream script.
   */
  readonly version?: string | number;
  readonly run: (
    params: TParams,
  ) => Promise<TOutput> | TOutput | Effect.Effect<TOutput, any, any>;
  readonly cleanup?: (
    params: TParams,
    output: TOutput,
  ) => Promise<void> | void | Effect.Effect<void, any, any>;
}

export class ScriptProviders extends Provider.ProviderCollection<ScriptProviders>()(
  "Script",
) {}

export interface Script<TOutput = any>
  extends Resource<
    "Alchemy.Script",
    ScriptProps<any, TOutput>,
    {
      readonly result: TOutput;
      readonly hash: string;
      readonly executedAt: number;
    },
    never,
    ScriptProviders
  > {}

const computeScriptHash = (props: ScriptProps<any, any>): string => {
  const hash = Crypto.createHash("sha256");
  // Identity is derived from declared inputs (params, triggers, version), NOT
  // the function source: refactoring the `run` body must not retrigger the
  // script, and changes the closure captures must be declared via `params`/
  // `triggers`/`version` to take effect.
  if (props.version !== undefined) {
    hash.update(String(props.version));
  }
  if (props.params !== undefined) {
    hash.update(JSON.stringify(props.params));
  }
  if (props.triggers !== undefined) {
    hash.update(JSON.stringify(props.triggers));
  }
  return hash.digest("hex");
};

export const ScriptProvider = () =>
  Provider.effect(
    Script,
    Effect.sync(() =>
      Script.Provider.of({
        list: () => Effect.succeed([]),
        read: ({ output }) => Effect.succeed(output),
        diff: ({ news, output }) =>
          Effect.gen(function* () {
            if (!output) return undefined;
            if (!isResolved(news)) return undefined;
            const newHash = computeScriptHash(news as any);
            if (output.hash !== newHash) {
              return { action: "update" as const };
            }
          }),
        reconcile: ({ news, output }) =>
          Effect.gen(function* () {
            const resolvedNews = news as ScriptProps<any, any>;
            const currentHash = computeScriptHash(resolvedNews);

            if (output && output.hash === currentHash) {
              return output;
            }

            const execution = resolvedNews.run(resolvedNews.params);
            let result: any;
            if (Effect.isEffect(execution)) {
              result = yield* execution;
            } else if (execution instanceof Promise) {
              result = yield* Effect.promise(() => execution);
            } else {
              result = execution;
            }

            return {
              result,
              hash: currentHash,
              executedAt: Date.now(),
            };
          }),
        delete: ({ olds, output }) =>
          Effect.gen(function* () {
            if (olds?.cleanup && output?.result) {
              const clean = olds.cleanup(olds.params, output.result);
              if (Effect.isEffect(clean)) {
                yield* clean;
              } else if (clean instanceof Promise) {
                yield* Effect.promise(() => clean);
              }
            }
          }),
      }),
    ),
  );

export const scriptProviders = () =>
  Layer.effect(ScriptProviders, Provider.collection([Script])).pipe(
    Layer.provide(ScriptProvider()),
  );

/**
 * Executes a yieldable TypeScript script and returns its strongly-typed result.
 */
const runScript = <TOutput, TParams = unknown>(
  options: ScriptRunOptions<TParams, TOutput>,
): Effect.Effect<TOutput, any, any> =>
  Effect.gen(function* () {
    const execution = options.run(options.params as TParams);
    if (Effect.isEffect(execution)) {
      return yield* execution;
    }
    if (execution instanceof Promise) {
      return yield* Effect.promise(() => execution);
    }
    return execution;
  });

export const Script = Object.assign(Resource<Script>("Alchemy.Script"), {
  Run: runScript,
});
