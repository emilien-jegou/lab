// Provisions an OIDC client on Kanidm and stores its generated secret.
import { Effect } from "effect";
import type { Output } from "alchemy/Output";

import * as Docker from "../../internal/docker";
import { Script } from "../../internal/script/Script";
import { SecretStore } from "../../internal/secrets/SecretStore";

import type { KanidmClientProps } from "./types";

export interface ClientProvisionParams {
  readonly containerId: Output<string>;
  readonly containerName: string;
  readonly network: Output<string>;
  readonly client: KanidmClientProps;
}

export const provisionClient = (
  name: string,
  params: ClientProvisionParams,
  triggers: readonly unknown[],
  secrets: SecretStore["Service"],
) =>
  Script(`${name}-${params.client.id}-client-provision`, {
    params,
    triggers: [...triggers],
    run: ({ network, client }) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;

        // Read the stable password saved by accountBootstrap
        const adminSecret = yield* secrets.get("kanidm", "idm_admin");
        const adminPass = adminSecret.value;

        if (!adminPass) return "";

        const toolRun = yield* docker.run([
          "container", "run", "--rm",
          "--network", network,
          "-e", `KANIDM_PASSWORD=${adminPass}`,
          "docker.io/kanidm/tools:latest",
          "/bin/sh", "-c",
          `
            set -e
            export HOME=/tmp
            K="kanidm -H https://kanidm:8443 --accept-invalid-certs"
            for i in 1 2 3 4 5; do
              if $K login -D idm_admin >/dev/null 2>&1; then break; fi
              sleep 1
            done
            $K system oauth2 create "${client.id}" "${client.name}" "${client.origin}" >/dev/null 2>&1 || true
            $K system oauth2 add-redirect-url "${client.id}" "${client.redirectUri}" >/dev/null 2>&1 || true
            $K system oauth2 update-scope-map "${client.id}" idm_admins openid email profile >/dev/null 2>&1 || true
            $K system oauth2 update-scope-map "${client.id}" idm_all_persons openid email profile >/dev/null 2>&1 || true
            $K system oauth2 warning-insecure-client-disable-pkce "${client.id}" >/dev/null 2>&1 || true
            $K system oauth2 warning-enable-legacy-crypto "${client.id}" >/dev/null 2>&1 || true
            $K system oauth2 show-basic-secret "${client.id}" | grep -v '^-' | tr -d '\\r\\n '
          `,
        ]).pipe(
          Effect.orElseSucceed(() => ({ stdout: "", stderr: "", exitCode: 1 })),
        );

        const extracted = toolRun.stdout.trim();

        // Save the real client secret to SecretStore
        if (extracted) {
          yield* secrets.set("kanidm-clients", client.id, extracted);
        }

        return extracted;
      }),
  });
