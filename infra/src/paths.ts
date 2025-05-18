import { Effect } from "effect";
import * as path from "node:path";
import * as fs from "node:fs";

// Anchors deterministically to the repo root (/projects/lab) regardless of where `bun` is run
const projectRoot = path.resolve(import.meta.dir, "../..");

/**
 * Resolves a service-scoped data directory without legacy BaseDataDir.
 */
export const resolveServiceDataPath = (
  serviceName: string,
  customServicePath?: string,
  subPath?: string,
): Effect.Effect<string, any, any> =>
  Effect.gen(function* () {
    const base = customServicePath
      ? path.resolve(customServicePath)
      : resolveProjectPath(".alchemy", serviceName);
    return subPath ? path.join(base, subPath) : base;
  });

/**
 * Resolves paths relative to the monorepo root (/projects/lab).
 */
export const resolveProjectPath = (...segments: string[]): string => {
  const target = path.resolve(projectRoot, ...segments);
  if (segments[0] === "lab" && !fs.existsSync(target) && fs.existsSync(path.resolve(projectRoot, "package.json"))) {
    return projectRoot;
  }
  return target;
};
