// infra/src/platform/openobserve/index.ts
import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import { EndpointHandle } from "../../gateway/ingress";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";

export interface OpenObserveProps {
  readonly rootEmail?: string;
  readonly rootPassword?: string | Redacted.Redacted<string>;
  readonly dataDir?: string;
}

export interface OpenObserveHandle {
  readonly name: string;
  readonly endpoint: EndpointHandle;
  readonly internalUrl: string;
  readonly auth: { readonly user: string; readonly pass: Redacted.Redacted<string> };
}

export const OpenObserve = (name: string, props: OpenObserveProps = {}) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;
    const dataVolume = props.dataDir ?? `${name}-data`;
    const userEmail = props.rootEmail ?? "admin@example.com";

    const rootPassword = yield* Secret.fromNullable(
      props.rootPassword,
      secrets.get("openobserve", "root_password"),
    );

    yield* Docker.Container(name, {
      image: "docker.io/openobserve/openobserve:latest",
      name,
      restart: "unless-stopped",
      networks: [{ name: net.name, aliases: ["openobserve", name.toLowerCase(), name] }],
      start: true,
      environment: {
        ZO_ROOT_USER_EMAIL: userEmail,
        ZO_ROOT_USER_PASSWORD: rootPassword.redacted,
        ZO_DATA_DIR: "/data",
        ZO_COMPACT_DATA_RETENTION_DAYS: "7",
        ZO_IGNORE_FILE_RETENTION_BY_STREAM: "true",
      },
      volumes: [{ hostPath: dataVolume, containerPath: "/data" }],
    });

    const endpoint: EndpointHandle = { host: "openobserve", port: 5080 };

    return {
      name,
      endpoint,
      internalUrl: `http://${name}:5080`,
      auth: { user: userEmail, pass: rootPassword.redacted },
    } satisfies OpenObserveHandle;
  });
