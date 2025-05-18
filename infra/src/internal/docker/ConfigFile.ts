import * as Crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import type { Providers } from "./Providers";

export interface ConfigFileProps {
  /** Absolute host path the file is materialized to. */
  path: string;
  /** File body written to `path`. */
  content: string;
  /** Octal file mode applied after write. @default 0o644 */
  mode?: number;
}

export interface ConfigFile extends Resource<
  "Docker.ConfigFile",
  ConfigFileProps,
  {
    /** Absolute host path the file was materialized to. */
    path: string;
    /** sha256 of the written content — feed this to a consumer's props to force
     *  ordering and replacement when the config body changes. */
    hash: string;
    /** Byte length of the written content. */
    bytes: number;
  },
  never,
  Providers
> {}

/**
 * A config file materialized onto the host and tracked in state.
 *
 * Replaces the old inline `Container.VolumeMapping.content` field, which let the
 * generic Docker provider perform hidden host filesystem writes that were
 * invisible to diff, drift detection, and destroy. A `ConfigFile` is a first-class
 * resource: reference its `path` in a container volume mount and its `hash` in a
 * container prop so the file is written before the container starts and the
 * container is replaced when the config body changes.
 *
 * @resource
 */
export const ConfigFile = Resource<ConfigFile>("Docker.ConfigFile");

const hashContent = (content: string): string =>
  Crypto.createHash("sha256").update(content).digest("hex");

export const ConfigFileProvider = () =>
  Provider.effect(
    ConfigFile,
    Effect.sync(() =>
      ConfigFile.Provider.of({
        list: () => Effect.succeed([]),
        read: Effect.fn(function* ({ output }) {
          if (!output) return undefined;
          // Re-hash the live file so host-side edits surface as drift.
          const live = yield* Effect.promise(async () => {
            try {
              return await fs.readFile(output.path, "utf-8");
            } catch {
              return undefined;
            }
          });
          if (live === undefined) return undefined;
          return {
            path: output.path,
            hash: hashContent(live),
            bytes: Buffer.byteLength(live),
          };
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news) || !output) return undefined;
          if (output.hash !== hashContent(news.content)) {
            return { action: "update" as const };
          }
        }),
        reconcile: Effect.fn(function* ({ news, output }) {
          const desiredHash = hashContent(news.content);
          if (output && output.hash === desiredHash) {
            return output;
          }
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(news.path), { recursive: true });
            await fs.writeFile(news.path, news.content, {
              encoding: "utf-8",
              mode: news.mode ?? 0o644,
            });
            // writeFile's `mode` is masked by umask on create; chmod forces it.
            await fs.chmod(news.path, news.mode ?? 0o644);
          });
          return {
            path: news.path,
            hash: desiredHash,
            bytes: Buffer.byteLength(news.content),
          };
        }),
        delete: Effect.fn(({ output }) =>
          Effect.promise(async () => {
            await fs.rm(output.path, { force: true });
          }),
        ),
      }),
    ),
  );
