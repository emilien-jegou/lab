// Recovers the idm_admin password and provisions the developer account.
import { Effect } from "effect";
import type { Output } from "alchemy/Output";

import * as Docker from "../../internal/docker";
import { Script } from "../../internal/script/Script";
import { SecretStore } from "../../internal/secrets/SecretStore";

export interface BootstrapParams {
  readonly containerId: Output<string>;
  readonly containerName: string;
  readonly network: Output<string>;
  readonly devPass: string;
}

export const bootstrapAccounts = (
  name: string,
  params: BootstrapParams,
  secrets: SecretStore["Service"],
) =>
  Script(`${name}-account-bootstrap`, {
    params,
    run: ({ containerName, network, devPass }) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;

        // Probe until Kanidm daemon is online
        for (let i = 0; i < 30; i++) {
          const probe = yield* docker.run([
            "container", "exec", containerName,
            "kanidmd", "server", "-c", "/etc/kanidm/server.toml", "--version",
          ]).pipe(Effect.orElseSucceed(() => ({ stdout: "", stderr: "", exitCode: 1 })));
          if (probe.exitCode === 0) break;
          yield* Effect.sleep("1 second");
        }

        // Single, exclusive recover-account call
        const recovery = yield* docker.run([
          "container", "exec", containerName,
          "kanidmd", "recover-account", "-c", "/etc/kanidm/server.toml", "idm_admin",
        ]).pipe(
          Effect.orElseSucceed(() => ({ stdout: "", stderr: "", exitCode: 1 })),
        );

        const raw = `${recovery.stdout}\n${recovery.stderr}`;
        const match =
          raw.match(/new_password:\s*"*([^"\s\r\n]+)"*/i)?.[1] ??
          raw.match(/"new_password":\s*"([^"]+)"/i)?.[1];

        const recoveredPass = match ? match.trim() : "";

        if (recoveredPass) {
          // Persist the real recovered password into SecretStore
          yield* secrets.set("kanidm", "idm_admin", recoveredPass);

          yield* docker.run([
            "container", "run", "--rm",
            "--network", network,
            "-e", `KANIDM_PASSWORD=${recoveredPass}`,
            "docker.io/kanidm/tools:latest",
            "/bin/sh", "-c",
            `
              export HOME=/tmp
              K="kanidm -H https://kanidm:8443 --accept-invalid-certs"
              for i in 1 2 3 4 5; do
                if $K login -D idm_admin >/dev/null 2>&1; then break; fi
                sleep 1
              done
              $K person create developer "Developer" >/dev/null 2>&1 || true
              echo "${devPass}" | $K person credential set-password developer >/dev/null 2>&1 || true
            `,
          ]).pipe(Effect.ignore);
        }

        return recoveredPass;
      }),
  });
