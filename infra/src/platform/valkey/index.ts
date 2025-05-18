// infra/src/platform/valkey/index.ts
import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import { EndpointHandle } from "../../gateway/ingress";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";
import { StorageInput, resolveStorageMount } from "../../storage";

export interface ValkeyProps {
  readonly password?: string | Redacted.Redacted<string>;
  readonly storage?: StorageInput;
  readonly dataDir?: string;
}

export interface ValkeyHandle {
  readonly endpoint: EndpointHandle;
  readonly password: Redacted.Redacted<string>;
}

export const Valkey = (name: string, props: ValkeyProps = {}) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;

    const password = yield* Secret.fromNullable(
      props.password,
      secrets.get("valkey", "password"),
    );

    const storage = yield* resolveStorageMount(
      name,
      "/data",
      props.storage ?? props.dataDir ?? `${name}-data`,
    );

    yield* Docker.Container(name, {
      start: true,
      restart: "unless-stopped",
      image: "docker.io/valkey/valkey-bundle:latest",
      name,
      networks: [{ name: net.name, aliases: ["valkey", "appcache", name.toLowerCase(), name] }],
      // Password is read from the environment at runtime (REDISCLI_AUTH) rather
      // than interpolated into argv, so it stays out of `docker inspect` Cmd and
      // the serialized plan/state.
      environment: {
        REDISCLI_AUTH: password.redacted,
      },
      command: [
        "sh",
        "-c",
        'exec valkey-server --requirepass "$REDISCLI_AUTH" --maxmemory 150mb --maxmemory-policy allkeys-lru',
      ],
      volumes: storage.volume ? [storage.volume] : [],
      mounts: storage.mount ? [storage.mount] : undefined,
      healthcheck: {
        cmd: 'valkey-cli -a "$REDISCLI_AUTH" --no-auth-warning ping | grep -q PONG',
        interval: "15 seconds",
        timeout: "3 seconds",
        retries: 5,
      },
    });

    return {
      endpoint: { host: name, port: 6379 },
      password: password.redacted,
    } satisfies ValkeyHandle;
  });
