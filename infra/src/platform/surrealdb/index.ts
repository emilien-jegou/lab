// infra/src/platform/surrealdb/index.ts
import * as Docker from "../../internal/docker";
import { Script } from "../../internal/script/Script";
import { Effect, Redacted } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EndpointHandle } from "../../gateway/ingress";
import { resolveServiceDataPath } from "../../paths";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";

export interface SurrealServerProps {
  readonly rootPassword?: string | Redacted.Redacted<string>;
  readonly dataDir?: string;
}

export interface SurrealServerHandle {
  readonly _tag: "SurrealServer";
  readonly containerName: string;
  readonly endpoint: EndpointHandle;
  readonly url: string;
  readonly rootUser: string;
  readonly rootPassword: Redacted.Redacted<string>;
}

export interface SurrealNamespaceProps {
  readonly server: SurrealServerHandle;
  readonly name: string;
}

export interface SurrealNamespaceHandle {
  readonly _tag: "SurrealNamespace";
  readonly server: SurrealServerHandle;
  readonly name: string;
}

export interface SurrealDatabaseProps {
  readonly server: SurrealServerHandle;
  readonly namespace: string | SurrealNamespaceHandle;
  readonly database?: string;
  readonly user?: string;
  readonly password?: string | Redacted.Redacted<string>;
}

export interface SurrealDatabaseHandle {
  readonly _tag: "SurrealDatabase";
  readonly server: SurrealServerHandle;
  readonly namespace: string;
  readonly database: string;
  readonly user: string;
  readonly password: Redacted.Redacted<string>;
  readonly endpoint: EndpointHandle;
  readonly url: string;
}

export type SurrealHandle = SurrealServerHandle | SurrealDatabaseHandle;

type DockerService = Docker.Docker["Service"];

/**
 * POST a SurrealQL statement to the server from inside the Docker network, using
 * an ephemeral curl container. This replaces the previous host-side
 * `fetch("http://localhost:6800")`, which only worked because the server happened
 * to publish 6800 to the host and bypassed the stack network entirely.
 */
const postSql = (
  docker: DockerService,
  network: string,
  target: EndpointHandle,
  rootPass: string,
  sql: string,
) =>
  docker
    .run([
      "container", "run", "--rm",
      "--network", network,
      "curlimages/curl:latest",
      "-sS", "-X", "POST",
      `http://${target.host}:${target.port}/sql`,
      "-u", `root:${rootPass}`,
      "-H", "Accept: application/json",
      "--data-raw", sql,
    ])
    .pipe(Effect.ignore);

const Server = (name: string, props: SurrealServerProps = {}) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;
    const dataVolume = props.dataDir ?? `${name}-data`;

    const rootPassword = yield* Secret.fromNullable(
      props.rootPassword,
      secrets.get("surrealdb", "root_password"),
    );

    yield* Docker.Container(name, {
      image: "docker.io/surrealdb/surrealdb:latest",
      name,
      networks: [{ name: net.name, aliases: ["surrealdb", name.toLowerCase(), name] }],
      start: true,
      restart: "unless-stopped",
      command: [
        "start",
        "--log", "info",
        "--bind", "0.0.0.0:6800",
        "--user", "root",
        "--pass", rootPassword.value,
        "rocksdb:/surrealdb/data/srdb.db",
      ],
      ports: [{ external: 6800, internal: 6800 }],
      volumes: [{ hostPath: dataVolume, containerPath: "/surrealdb/data" }],
    });

    return {
      _tag: "SurrealServer",
      containerName: name,
      endpoint: { host: "surrealdb", port: 6800 },
      url: `http://${name}:6800/`,
      rootUser: "root",
      rootPassword: rootPassword.redacted,
    } satisfies SurrealServerHandle;
  });

const Namespace = (name: string, props: SurrealNamespaceProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const rootPass = Redacted.value(props.server.rootPassword);

    yield* Script(`${name}-namespace-provision`, {
      params: {
        network: net.name,
        target: props.server.endpoint,
        ns: props.name,
      },
      run: ({ network, target, ns }) =>
        Effect.gen(function* () {
          const docker = yield* Docker.Docker;
          yield* postSql(
            docker,
            network,
            target,
            rootPass,
            `DEFINE NAMESPACE IF NOT EXISTS ${ns};`,
          );
        }),
    });

    return {
      _tag: "SurrealNamespace",
      server: props.server,
      name: props.name,
    } satisfies SurrealNamespaceHandle;
  });

const Database = (name: string, props: SurrealDatabaseProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;
    const ns = typeof props.namespace === "string" ? props.namespace : props.namespace.name;
    const db = props.database ?? name;
    const dbUser = props.user ?? `${db}_user`;

    const dbPassword = yield* Secret.fromNullable(
      props.password,
      secrets.get(`surrealdb/${props.server.containerName}`, `${ns}_${db}_password`),
    );

    const rootPass = Redacted.value(props.server.rootPassword);

    // The database password is closed over (resolved from the vault at compose
    // time) rather than placed in hashed `params`, so it never lands in the
    // serialized plan/state. Bump `version` to force a re-provision after
    // rotation.
    yield* Script(`${name}-db-provision`, {
      params: {
        network: net.name,
        target: props.server.endpoint,
        ns,
        db,
        user: dbUser,
      },
      run: ({ network, target, ns, db, user }) =>
        Effect.gen(function* () {
          const docker = yield* Docker.Docker;
          const sql = [
            `DEFINE NAMESPACE IF NOT EXISTS ${ns};`,
            `USE NS ${ns};`,
            `DEFINE DATABASE IF NOT EXISTS ${db};`,
            `USE DB ${db};`,
            `DEFINE USER IF NOT EXISTS ${user} ON DATABASE PASSWORD '${dbPassword.value}' ROLES OWNER;`,
          ].join(" ");
          yield* postSql(docker, network, target, rootPass, sql);
        }),
    });

    return {
      _tag: "SurrealDatabase",
      server: props.server,
      namespace: ns,
      database: db,
      user: dbUser,
      password: dbPassword.redacted,
      endpoint: props.server.endpoint,
      url: props.server.url,
    } satisfies SurrealDatabaseHandle;
  });

export const SurrealDB = Object.assign(Server, {
  Server,
  Namespace,
  Database,
});
