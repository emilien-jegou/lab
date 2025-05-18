// Generates a self-signed TLS chain for Kanidm via a tracked Script resource.
import { Effect } from "effect";
import * as fs from "node:fs/promises";

import { Script } from "../../internal/script/Script";

export interface CertPaths {
  readonly certsDir: string;
  readonly domain: string;
  readonly chainPath: string;
  readonly keyPath: string;
}

export const provisionCerts = (name: string, paths: CertPaths) =>
  Script(`${name}-certs`, {
    params: paths,
    run: ({ certsDir, domain, chainPath, keyPath }) =>
      Effect.promise(async () => {
        try {
          await Promise.all([fs.access(chainPath), fs.access(keyPath)]);
          return;
        } catch {}

        await fs.mkdir(certsDir, { recursive: true });
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);

        try {
          await execFileAsync("openssl", [
            "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", keyPath, "-out", chainPath, "-days", "3650",
            "-subj", `/CN=${domain}`,
          ]);
        } catch {
          await execFileAsync("docker", [
            "run", "--rm", "-v", `${certsDir}:/certs`, "docker.io/alpine/openssl:latest",
            "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", "/certs/key.pem", "-out", "/certs/chain.pem", "-days", "3650",
            "-subj", `/CN=${domain}`,
          ]);
        }

        await fs.chmod(keyPath, 0o644);
        await fs.chmod(chainPath, 0o644);
      }),
  });
