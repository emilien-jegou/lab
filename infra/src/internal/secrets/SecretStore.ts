// infra/src/internal/secrets/SecretStore.ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as util from "node:util";
import { resolveProjectPath } from "../../paths";

export interface Secret {
  /** The raw plaintext value. Explicit access is required to read it. */
  readonly value: string;
  /** The Effect Redacted wrapper (for return handles and attributes). */
  readonly redacted: Redacted.Redacted<string>;
  /**
   * Redacting stringifier. Returns `"<redacted>"` so an accidental
   * `${secret}` / `String(secret)` cannot leak plaintext into argv, config
   * strings, or state. Read `secret.value` explicitly when you need the secret.
   */
  toString(): string;
  [Symbol.toPrimitive]?(hint: string): string;
  [util.inspect.custom]?(): string;
}

export const Secret = {
  /** Wraps any string or Redacted value into an ergonomic Secret object. */
  from: (val: string | Redacted.Redacted<string>): Secret => {
    const raw = Redacted.isRedacted(val) ? Redacted.value(val) : val;
    return {
      value: raw,
      redacted: Redacted.isRedacted(val) ? val : Redacted.make(raw),
      toString: () => "<redacted>",
      [Symbol.toPrimitive]: () => "<redacted>",
      [util.inspect.custom]: () => "<redacted>",
    };
  },

  /** Idiomatic fallback: uses provided value if present; otherwise runs fallback Effect. */
  fromNullable: (
    val: string | Redacted.Redacted<string> | undefined | null,
    fallback: Effect.Effect<Secret, any, any>,
  ): Effect.Effect<Secret, any, any> =>
    val != null ? Effect.succeed(Secret.from(val)) : fallback,
};

export interface SecretOptions {
  readonly bytes?: number;
  readonly encoding?: "hex" | "base64" | "base64url";
}

export class SecretStore extends Context.Service<
  SecretStore,
  {
    readonly get: (
      scope: string,
      name: string,
      options?: SecretOptions,
    ) => Effect.Effect<Secret>;

    readonly set: (
      scope: string,
      name: string,
      value: string,
    ) => Effect.Effect<void>;

    readonly readScope: (
      scope: string,
    ) => Effect.Effect<Record<string, Redacted.Redacted<string>>>;
  }
>()("@alchemy/SecretStore") {}

export const SecretStoreLive = (customVaultPath?: string) =>
  Layer.succeed(
    SecretStore,
    SecretStore.of({
      get: (scope, name, options) =>
        Effect.gen(function* () {
          const vaultFile = customVaultPath
            ? path.resolve(customVaultPath)
            : resolveProjectPath(".alchemy/secrets.json");
          const key = `${scope}:${name}`;

          return yield* Effect.promise(async () => {
            let vault: Record<string, string> = {};
            try {
              const content = await fs.readFile(vaultFile, "utf-8");
              vault = JSON.parse(content);
            } catch {}

            if (vault[key]) {
              return Secret.from(vault[key]);
            }

            const bytes = options?.bytes ?? 24;
            const encoding = options?.encoding ?? "hex";
            const generated = Crypto.randomBytes(bytes).toString(encoding);

            vault[key] = generated;

            await fs.mkdir(path.dirname(vaultFile), { recursive: true });
            await fs.writeFile(vaultFile, JSON.stringify(vault, null, 2) + "\n", {
              encoding: "utf-8",
              mode: 0o600,
            });

            return Secret.from(generated);
          });
        }),

      set: (scope, name, value) =>
        Effect.gen(function* () {
          const vaultFile = customVaultPath
            ? path.resolve(customVaultPath)
            : resolveProjectPath(".alchemy/secrets.json");
          const key = `${scope}:${name}`;

          yield* Effect.promise(async () => {
            let vault: Record<string, string> = {};
            try {
              const content = await fs.readFile(vaultFile, "utf-8");
              vault = JSON.parse(content);
            } catch {}

            vault[key] = value;

            await fs.mkdir(path.dirname(vaultFile), { recursive: true });
            await fs.writeFile(vaultFile, JSON.stringify(vault, null, 2) + "\n", {
              encoding: "utf-8",
              mode: 0o600,
            });
          });
        }),

      readScope: (scope) =>
        Effect.gen(function* () {
          const vaultFile = customVaultPath
            ? path.resolve(customVaultPath)
            : resolveProjectPath(".alchemy/secrets.json");

          return yield* Effect.promise(async () => {
            try {
              const content = await fs.readFile(vaultFile, "utf-8");
              const vault: Record<string, string> = JSON.parse(content);
              const result: Record<string, Redacted.Redacted<string>> = {};
              const prefix = `${scope}:`;

              for (const [k, v] of Object.entries(vault)) {
                if (k.startsWith(prefix)) {
                  const secretName = k.slice(prefix.length);
                  result[secretName] = Redacted.make(v);
                }
              }
              return result;
            } catch {
              return {};
            }
          });
        }),
    }),
  );
