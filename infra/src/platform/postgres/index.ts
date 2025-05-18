import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import { EndpointHandle } from "../../gateway/ingress";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";
import { StorageInput, resolveStorageMount } from "../../storage";

export interface PostgresProps {
  readonly user?: string;
  readonly password?: string | Redacted.Redacted<string>;
  readonly database?: string;
  readonly storage?: StorageInput;
  readonly dataDir?: string;
}

export interface PostgresHandle {
  readonly endpoint: EndpointHandle;
  readonly connectionString: string;
  readonly user: string;
  readonly password: Redacted.Redacted<string>;
  readonly database: string;
}

export const Postgres = (name: string, props: PostgresProps = {}) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;
    const user = props.user ?? "oxicloud";
    const database = props.database ?? "oxicloud";

    const password = yield* Secret.fromNullable(
      props.password,
      secrets.get(`postgres/${name}`, "password"),
    );

    const storage = yield* resolveStorageMount(
      name,
      "/var/lib/postgresql/data",
      props.storage ?? props.dataDir ?? `${name}-data`,
    );

    yield* Docker.Container(name, {
      start: true,
      restart: "unless-stopped",
      image: "docker.io/library/postgres:17-alpine",
      name,
      networks: [{ name: net.name, aliases: [name] }],
      environment: {
        POSTGRES_USER: user,
        POSTGRES_PASSWORD: password.redacted,
        POSTGRES_DB: database,
      },
      volumes: storage.volume ? [storage.volume] : [],
      mounts: storage.mount ? [storage.mount] : undefined,
      healthcheck: {
        cmd: ["pg_isready", "-U", user, "-d", database],
        interval: "5 seconds",
        timeout: "5 seconds",
        retries: 5,
      },
    });

    return {
      endpoint: { host: name, port: 5432 },
      connectionString: `postgres://${user}:${password.value}@${name}:5432/${database}`,
      user,
      password: password.redacted,
      database,
    } satisfies PostgresHandle;
  });
