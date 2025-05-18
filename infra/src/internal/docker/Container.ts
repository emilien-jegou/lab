import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import {
  PlatformError,
  SystemError,
  type SystemErrorTag,
} from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { createInternalTags, hasAlchemyTags } from "alchemy/Tags";
import { Docker, dockerContextName, dockerPhysicalName } from "./Docker";
import type { Providers } from "./Providers";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ContainerProps {
  /** Image reference or Docker image resource. */
  image: Container.Image;
  /** Docker context name or context resource. */
  context?: Docker.ContextRef;
  /**
   * Container name.
   *
   * @default Generated from stack, stage, logical id, and instance id.
   */
  name?: string;
  /** Command to run in the container. */
  command?: string[];
  /** Overrides the image's default entrypoint. */
  entrypoint?: string | string[];
  /** Container environment variables. Use Redacted for secrets. */
  environment?: Record<string, string | Redacted.Redacted<string>>;
  /** Host/container port mappings. */
  ports?: Container.PortMapping[];
  /** Volume or bind mounts. For generated config files, mount a `Docker.ConfigFile` path. */
  volumes?: Container.VolumeMapping[];
  /** Advanced Docker `--mount` specifications (e.g. `["type=bind,source=/host,target=/app"]`). */
  mounts?: string[];
  /**
   * Restart policy. Either a standard policy, a retry-bounded string
   * (`"on-failure:5"`), or a structured configuration object.
   */
  restart?:
    | "no"
    | "always"
    | "on-failure"
    | "unless-stopped"
    | `on-failure:${number}`
    | {
        policy: "no" | "always" | "on-failure" | "unless-stopped";
        maxRetries?: number;
      };
  /**
   * Container labels. Alchemy's internal ownership labels are added
   * automatically.
   */
  labels?: Record<string, string>;
  /**
   * Grace period before Docker forcefully kills the container after stopping
   * it.
   */
  stopTimeout?: Duration.Input;
  /** Networks to connect after create. */
  networks?: Container.NetworkMapping[];
  /**
   * Extra `/etc/hosts` entries, each `hostname:address`.
   */
  extraHosts?: string[];
  /** Remove the container when it exits. @default false */
  removeOnExit?: boolean;
  /** Start the container after creation/reconciliation. @default false */
  start?: boolean;
  /** Docker healthcheck configuration. */
  healthcheck?: Container.Healthcheck;
  /**
   * Health-gated readiness configuration.
   */
  readiness?:
    | "started"
    | "running"
    | "healthy"
    | "completed"
    | Container.ReadinessOptions;
  /** Run container in privileged mode. */
  privileged?: boolean;
  /** Security options, e.g. `["seccomp=unconfined"]`. */
  securityOpt?: string[];
  /** Linux capabilities to add, e.g. `["SYS_NICE"]`. */
  capAdd?: string[];
  /** Linux capabilities to drop, e.g. `["ALL"]`. */
  capDrop?: string[];
  /** Container ulimits, e.g. `["memlock=-1:-1"]`. */
  ulimits?: string[];
  /** Username or UID (and optionally groupname or GID) to run as, e.g. `"1000:1000"`. */
  user?: string;
  /** Working directory inside the container. */
  workingDir?: string;
  /** Run an init process inside the container that forwards signals and reaps processes (`--init`). */
  init?: boolean;
  /** Mount the container's root filesystem as read-only (`--read-only`). */
  readOnlyRoot?: boolean;
  /** Size of `/dev/shm`, e.g. `"256m"` or `"1g"`. */
  shmSize?: string | number;
  /** Host devices to add to the container, e.g. `["/dev/snd", "/dev/net/tun"]`. */
  devices?: string[];
  /** Tmpfs mounts, e.g. `["/tmp:rw,noexec,nosuid,size=64m"]`. */
  tmpfs?: string[];
  /** Sysctl options, e.g. `{ "net.core.somaxconn": "1024" }`. */
  sysctls?: Record<string, string>;
  /** Custom DNS servers. */
  dns?: string[];
  /** Custom DNS search domains. */
  dnsSearch?: string[];
  /** Number of CPUs, e.g. `1.5` or `"2"`. */
  cpus?: number | string;
  /** Memory limit, e.g. `"512m"` or `"2g"`. */
  memory?: string | number;
  /** Memory soft reservation limit, e.g. `"256m"`. */
  memoryReservation?: string | number;
  /** Total memory limit plus swap, e.g. `"1g"`. Set to -1 for unlimited swap. */
  memorySwap?: string | number;
  /** Logging driver, e.g. `"json-file"`, `"syslog"`. */
  logDriver?: string;
  /** Logging driver options. */
  logOpts?: Record<string, string>;
}

export declare namespace Container {
  type Status =
    | "created"
    | "running"
    | "paused"
    | "restarting"
    | "removing"
    | "exited"
    | "dead";
  type HealthStatus = "none" | "starting" | "healthy" | "unhealthy";
  type Image = string | { imageRef: string };
  interface PortMapping {
    external: number | string;
    internal: number | string;
    protocol?: "tcp" | "udp" | "sctp";
  }
  interface VolumeMapping {
    hostPath?: string;
    containerPath: string;
    readOnly?: boolean;
    mode?: "ro" | "rw" | "z" | "Z" | (string & {});
  }
  interface NetworkMapping {
    name: string;
    aliases?: string[];
  }
  interface Healthcheck {
    cmd: string[] | string;
    interval?: Duration.Input;
    timeout?: Duration.Input;
    retries?: number;
    startPeriod?: Duration.Input;
    startInterval?: Duration.Input;
  }
  interface ReadinessOptions {
    condition?: "started" | "running" | "healthy" | "completed";
    timeout?: Duration.Input;
    interval?: Duration.Input;
  }
}

export interface Container extends Resource<
  "Docker.Container",
  ContainerProps,
  {
    id: string;
    name: string;
    status: Container.Status;
    health: Container.HealthStatus;
    createdAt: number;
    imageRef: string;
    ports: Record<string, number>;
  },
  never,
  Providers
> {}

export const Container = Resource<Container>("Docker.Container");

export const inspectContainer = (
  name: string,
  context?: Docker.ContextRef,
): Effect.Effect<Container["Attributes"], PlatformError, Docker> =>
  Docker.pipe(
    Effect.flatMap((docker) =>
      docker.container.inspect(name, dockerContextName(context)),
    ),
    Effect.map((container) =>
      toContainerAttributes(container, container.Config.Image),
    ),
  );

export const ContainerProvider = () =>
  Provider.effect(
    Container,
    Effect.gen(function* () {
      const docker = yield* Docker;

      const filterAutoAliases = (
        aliases: string[] | null | undefined,
        liveContainer: Docker.Container,
      ) => {
        const auto = new Set([
          liveContainer.Id,
          liveContainer.Id.slice(0, 12),
          liveContainer.Name?.replace(/^\//, ""),
        ]);
        return (aliases ?? []).filter((a) => !auto.has(a));
      };

      const reconcileNetworks = Effect.fn(function* (
        live: Docker.Container,
        news: ContainerProps,
        olds: ContainerProps | undefined,
      ) {
        const context = dockerContextName(news.context);
        const connect = new Map<string, Container.NetworkMapping>();
        const disconnect = new Set<string>();

        for (const network of news.networks ?? []) {
          const entry = live.NetworkSettings.Networks?.[network.name];
          if (!entry) {
            connect.set(network.name, network);
          } else {
            const liveAliases = filterAutoAliases(entry.Aliases, live);
            const desiredAliases = network.aliases ?? [];
            if (!Equal.equals(new Set(liveAliases), new Set(desiredAliases))) {
              connect.set(network.name, network);
              disconnect.add(network.name);
            }
          }
        }

        const desired = new Set((news.networks ?? []).map((n) => n.name));
        for (const network of olds?.networks ?? []) {
          if (
            !desired.has(network.name) &&
            live.NetworkSettings.Networks?.[network.name]
          ) {
            disconnect.add(network.name);
          }
        }
        yield* Effect.forEach(
          disconnect,
          (network) =>
            docker.network
              .disconnect({ network, container: live.Id, context })
              .pipe(Effect.ignore),
          { concurrency: "unbounded" },
        );
        yield* Effect.forEach(
          connect.values(),
          (network) =>
            docker.network.connect({
              network: network.name,
              container: live.Id,
              alias: network.aliases,
              context,
            }),
          { concurrency: "unbounded" },
        );
      });

      return Container.Provider.of({
        list: () => Effect.succeed([]),
        read: Effect.fn(function* ({ id, instanceId, olds, output }) {
          const context = dockerContextName(olds.context);
          const name = yield* dockerPhysicalName(id, olds, instanceId);
          const info = yield* docker.container
            .inspect(name, context)
            .pipe(
              Effect.catchReason(
                "PlatformError",
                "NotFound",
                () => Effect.undefined,
              ),
            );
          if (!info) return undefined;
          const attrs = toContainerAttributes(
            info,
            olds.image !== undefined
              ? normalizeImageRef(olds.image)
              : info.Config.Image,
          );
          if (output) return attrs;
          const owned = yield* hasAlchemyTags(
            id,
            info.Config.Labels ?? undefined,
          );
          return owned ? attrs : Unowned(attrs);
        }),
        diff: Effect.fn(function* ({ id, instanceId, news, olds }) {
          if (!isResolved(news)) return undefined;
          if (olds.image === undefined) return undefined;
          if (
            dockerContextName(olds.context) !== dockerContextName(news.context)
          ) {
            return { action: "replace" as const, deleteFirst: true };
          }
          const oldArgs = yield* makeCreateArgs(id, olds, instanceId);
          const newArgs = yield* makeCreateArgs(id, news, instanceId);

          const {
            network: _oNet,
            "network-alias": _oAlias,
            ...comparableOldArgs
          } = oldArgs;
          const {
            network: _nNet,
            "network-alias": _nAlias,
            ...comparableNewArgs
          } = newArgs;

          if (!Equal.equals(comparableOldArgs, comparableNewArgs)) {
            return { action: "replace" as const, deleteFirst: true };
          }

          if (!Equal.equals(olds.volumes, news.volumes)) {
            return { action: "replace" as const, deleteFirst: true };
          }

          if (
            !Equal.equals(olds.networks ?? [], news.networks ?? []) ||
            (olds.start ?? false) !== (news.start ?? false) ||
            !Equal.equals(olds.readiness, news.readiness)
          ) {
            return { action: "update" as const };
          }
        }),
        reconcile: Effect.fn(function* ({ id, instanceId, news, olds }) {
          const context = dockerContextName(news.context);
          const args = yield* makeCreateArgs(id, news, instanceId);

          // Ensure bind-mount directories exist before the container starts
          yield* Effect.promise(async () => {
            for (const v of news.volumes ?? []) {
              if (v.hostPath) {
                if (path.isAbsolute(v.hostPath)) {
                  try {
                    const stat = await fs.stat(v.hostPath);
                    if (stat.isFile() || stat.isDirectory()) continue;
                  } catch {
                    if (path.extname(v.hostPath)) {
                      await fs.mkdir(path.dirname(v.hostPath), { recursive: true });
                    } else {
                      await fs.mkdir(v.hostPath, { recursive: true });
                    }
                  }
                }
              }
            }
          });

          const live = yield* docker.container
            .inspect(args.name, context)
            .pipe(
              Effect.catchReason(
                "PlatformError",
                "NotFound",
                () => Effect.undefined,
              ),
            );

          let targetContainerId: string;

          if (live) {
            targetContainerId = live.Id;
            yield* reconcileNetworks(live, news, olds);
            if (news.start && live.State.Status !== "running") {
              yield* docker.container.start(live.Id, context);
            } else if (!news.start && live.State.Status === "running") {
              yield* docker.container.stop(live.Id, context);
            }
          } else {
            const internalTags = yield* createInternalTags(id);
            const { stdout: containerId } = yield* docker.container.create({
              ...args,
              context,
              label: { ...args.label, ...internalTags },
            });
            targetContainerId = containerId;

            const additionalNetworks = news.networks ? news.networks.slice(1) : [];
            yield* Effect.forEach(
              additionalNetworks,
              (network) =>
                docker.network.connect({
                  network: network.name,
                  container: containerId,
                  alias: network.aliases,
                  context,
                }),
              { concurrency: "unbounded" },
            );

            if (news.start) {
              yield* docker.container.start(containerId, context);
            }
          }

          if (news.start) {
            const readiness = resolveReadiness(news);
            if (readiness.condition !== "started") {
              const readyInfo = yield* waitForContainerReadiness(
                docker,
                targetContainerId,
                readiness,
                news,
                context,
              );
              return toContainerAttributes(readyInfo, args.image);
            }
          }

          const info = yield* docker.container.inspect(targetContainerId, context);
          return toContainerAttributes(info, args.image);
        }),
        delete: Effect.fn(({ olds, output }) =>
          docker.container
            .stop(output.name, dockerContextName(olds.context))
            .pipe(
              Effect.andThen(
                docker.container.remove(
                  output.name,
                  true,
                  dockerContextName(olds.context),
                ),
              ),
              Effect.catchReason(
                "PlatformError",
                "NotFound",
                () => Effect.void,
              ),
            ),
        ),
      });
    }),
  );

const resolveReadiness = (
  props: ContainerProps,
): Required<Container.ReadinessOptions> => {
  const defaultCondition = props.healthcheck ? "healthy" : "running";

  let defaultTimeoutMs = 60000;
  if (props.healthcheck?.startPeriod) {
    defaultTimeoutMs = Math.max(
      defaultTimeoutMs,
      Duration.toMillis(
        Duration.fromInputUnsafe(props.healthcheck.startPeriod),
      ) + 30000,
    );
  }

  if (!props.readiness) {
    return {
      condition: defaultCondition,
      timeout: Duration.millis(defaultTimeoutMs),
      interval: Duration.millis(500),
    };
  }

  if (typeof props.readiness === "string") {
    return {
      condition: props.readiness,
      timeout: Duration.millis(defaultTimeoutMs),
      interval: Duration.millis(500),
    };
  }

  return {
    condition: props.readiness.condition ?? defaultCondition,
    timeout: props.readiness.timeout
      ? Duration.fromInputUnsafe(props.readiness.timeout)
      : Duration.millis(defaultTimeoutMs),
    interval: props.readiness.interval
      ? Duration.fromInputUnsafe(props.readiness.interval)
      : Duration.millis(500),
  };
};

const waitForContainerReadiness = (
  docker: Docker["Service"],
  nameOrId: string,
  options: Required<Container.ReadinessOptions>,
  props: ContainerProps,
  context?: string,
): Effect.Effect<Docker.Container, PlatformError> =>
  Effect.gen(function* () {
    const startTime = Date.now();
    const timeoutMs = Duration.toMillis(options.timeout);

    const fetchDiagnosticLogs = docker.container
      .logs(nameOrId, { tail: 20 }, context)
      .pipe(
        Effect.map((logs) => logs.trim()),
        Effect.orElseSucceed(() => ""),
      );

    while (true) {
      const inspectResult = yield* docker.container
        .inspect(nameOrId, context)
        .pipe(
          Effect.map((res) => ({ ok: true as const, info: res })),
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed({ ok: false as const }),
          ),
        );

      if (!inspectResult.ok) {
        if (props.removeOnExit) {
          return yield* Effect.fail(
            systemError({
              _tag: "NotFound",
              args: ["container", "inspect", nameOrId],
              description: `Container '${nameOrId}' exited immediately after start and was removed by Docker because 'removeOnExit: true' is enabled.`,
            }),
          );
        }
        return yield* Effect.fail(
          systemError({
            _tag: "NotFound",
            args: ["container", "inspect", nameOrId],
            description: `Container '${nameOrId}' was not found during readiness check.`,
          }),
        );
      }

      const info = inspectResult.info;
      const status = info.State.Status;
      const isRestarting =
        status === "restarting" || Boolean(info.State.Restarting);

      if (status === "paused" || status === "removing") {
        return yield* Effect.fail(
          systemError({
            _tag: "Unknown",
            args: ["container", "inspect", nameOrId],
            description: `Container '${nameOrId}' cannot reach readiness because its status is '${status}'.`,
          }),
        );
      }

      if (status === "exited" || status === "dead") {
        const exitCode = info.State.ExitCode ?? "unknown";
        const err = info.State.Error;
        const logs = yield* fetchDiagnosticLogs;

        if (options.condition === "completed") {
          if (exitCode === 0) {
            return info;
          }
          return yield* Effect.fail(
            systemError({
              _tag: "Unknown",
              args: ["container", "inspect", nameOrId],
              description: `Task container '${nameOrId}' failed with exit code ${exitCode}.${err ? ` Error: ${err}` : ""}${logs ? `\nLast logs:\n${logs}` : ""}`,
            }),
          );
        }

        const details = [
          exitCode === 0
            ? "Container exited with code 0. If this is a run-to-completion task (e.g. migration or seed), configure 'readiness: \"completed\"'."
            : undefined,
          err ? `Error: ${err}` : undefined,
          logs ? `Last logs:\n${logs}` : undefined,
        ]
          .filter(Boolean)
          .join("\n");

        return yield* Effect.fail(
          systemError({
            _tag: "Unknown",
            args: ["container", "inspect", nameOrId],
            description: `Container '${nameOrId}' stopped unexpectedly (status: ${status}, exit code: ${exitCode}).${details ? `\n${details}` : ""}`,
          }),
        );
      }

      if (isRestarting && (info.RestartCount ?? 0) > 0) {
        const exitCode = info.State.ExitCode ?? "unknown";
        const logs = yield* fetchDiagnosticLogs;
        return yield* Effect.fail(
          systemError({
            _tag: "Unknown",
            args: ["container", "inspect", nameOrId],
            description: `Container '${nameOrId}' is crash-looping (status: restarting, restart count: ${info.RestartCount}, last exit code: ${exitCode}).${logs ? `\nLast logs:\n${logs}` : ""}`,
          }),
        );
      }

      if (options.condition === "running" && status === "running") {
        return info;
      }

      if (options.condition === "healthy") {
        const health = info.State.Health;

        if (!health || health.Status === "none") {
          if (!props.healthcheck && status === "running") {
            return info;
          }
        } else if (health.Status === "healthy") {
          return info;
        } else if (health.Status === "unhealthy") {
          const lastEntry =
            health.Log && health.Log.length > 0
              ? health.Log[health.Log.length - 1]
              : undefined;
          const failureReason =
            lastEntry?.Output?.trim() ||
            (lastEntry
              ? `Command failed with exit code ${lastEntry.ExitCode} (no output)`
              : "No health check log available");

          return yield* Effect.fail(
            systemError({
              _tag: "Unknown",
              args: ["container", "inspect", nameOrId],
              description: `Container '${nameOrId}' failed health checks (status: unhealthy). Failure details: ${failureReason}`,
            }),
          );
        }
      }

      if (Date.now() - startTime >= timeoutMs) {
        const logs = yield* fetchDiagnosticLogs;
        return yield* Effect.fail(
          systemError({
            _tag: "Unknown",
            args: ["container", "inspect", nameOrId],
            description: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for container '${nameOrId}' to become ${options.condition}.${logs ? `\nRecent logs:\n${logs}` : ""}`,
          }),
        );
      }

      yield* Effect.sleep(options.interval);
    }
  });

const normalizeImageRef = (image: Container.Image): string =>
  typeof image === "string" ? image : image.imageRef;

const normalizeRestartPolicy = (
  restart: ContainerProps["restart"],
):
  | "no"
  | "always"
  | "on-failure"
  | "unless-stopped"
  | { custom: string } => {
  if (!restart) return "no";
  if (typeof restart === "string") {
    if (
      restart === "no" ||
      restart === "always" ||
      restart === "on-failure" ||
      restart === "unless-stopped"
    ) {
      return restart;
    }
    return { custom: restart };
  }
  if (restart.policy === "on-failure" && restart.maxRetries !== undefined) {
    return { custom: `on-failure:${restart.maxRetries}` };
  }
  return restart.policy;
};

const formatVolume = (v: Container.VolumeMapping): string => {
  if (!v.hostPath) return v.containerPath;
  const modes: string[] = [];
  if (v.mode) modes.push(v.mode);
  if (v.readOnly && !modes.some((m) => m.includes("ro"))) {
    modes.push("ro");
  }
  const suffix = modes.length > 0 ? `:${modes.join(",")}` : "";
  return `${v.hostPath}:${v.containerPath}${suffix}`;
};

const makeCreateArgs = (id: string, news: ContainerProps, instanceId: string) =>
  dockerPhysicalName(id, news, instanceId).pipe(
    Effect.map(
      (name): Parameters<Docker["Service"]["container"]["create"]>[0] => {
        let entrypoint: string | undefined;
        let command = news.command;
        if (Array.isArray(news.entrypoint)) {
          if (news.entrypoint.length === 0) {
            entrypoint = "";
          } else {
            entrypoint = news.entrypoint[0];
            if (news.entrypoint.length > 1) {
              command = [...news.entrypoint.slice(1), ...(news.command ?? [])];
            }
          }
        } else if (typeof news.entrypoint === "string") {
          entrypoint = news.entrypoint;
        }

        const primaryNetwork = news.networks?.[0];

        return {
          name,
          image: normalizeImageRef(news.image),
          command,
          entrypoint,
          env: normalizeEnvironment(news.environment),
          volume: news.volumes?.map(formatVolume),
          mount: news.mounts,
          p: news.ports?.map((port) => {
            const target = `${port.internal}/${port.protocol ?? "tcp"}`;
            return isRandomHostPort(port.external)
              ? target
              : `${port.external}:${target}`;
          }),
          network: primaryNetwork?.name,
          "network-alias": primaryNetwork?.aliases,
          "add-host": news.extraHosts,
          restart: normalizeRestartPolicy(news.restart),
          label: news.labels,
          "stop-timeout": toSeconds(news.stopTimeout)?.toString(),
          rm: news.removeOnExit ?? false,
          privileged: news.privileged,
          "security-opt": news.securityOpt,
          "cap-add": news.capAdd,
          "cap-drop": news.capDrop,
          ulimit: news.ulimits,
          user: news.user,
          workdir: news.workingDir,
          init: news.init,
          "read-only": news.readOnlyRoot,
          "shm-size":
            news.shmSize !== undefined ? String(news.shmSize) : undefined,
          device: news.devices,
          tmpfs: news.tmpfs,
          sysctl: news.sysctls,
          dns: news.dns,
          "dns-search": news.dnsSearch,
          cpus: news.cpus !== undefined ? String(news.cpus) : undefined,
          memory: news.memory !== undefined ? String(news.memory) : undefined,
          "memory-reservation":
            news.memoryReservation !== undefined
              ? String(news.memoryReservation)
              : undefined,
          "memory-swap":
            news.memorySwap !== undefined ? String(news.memorySwap) : undefined,
          "log-driver": news.logDriver,
          "log-opt": news.logOpts,
          ...(news.healthcheck
            ? {
                "health-cmd": Array.isArray(news.healthcheck.cmd)
                  ? news.healthcheck.cmd.join(" ")
                  : news.healthcheck.cmd,
                "health-interval": normalizeDuration(news.healthcheck.interval),
                "health-timeout": normalizeDuration(news.healthcheck.timeout),
                "health-retries": news.healthcheck.retries ?? 0,
                "health-start-period": normalizeDuration(
                  news.healthcheck.startPeriod,
                ),
                "health-start-interval": normalizeDuration(
                  news.healthcheck.startInterval,
                ),
              }
            : {
                "health-cmd": undefined,
                "health-interval": undefined,
                "health-timeout": undefined,
                "health-retries": undefined,
                "health-start-period": undefined,
                "health-start-interval": undefined,
              }),
        };
      },
    ),
  );

const toContainerAttributes = (
  info: Docker.Container,
  imageRef: string,
): Container["Attributes"] => ({
  id: info.Id,
  name: typeof info.Name === "string" ? info.Name.replace(/^\//, "") : info.Id,
  status: info.State.Status,
  health: info.State.Health?.Status ?? "none",
  createdAt: Date.parse(info.Created) || Date.now(),
  imageRef,
  ports: toPortAttributes(info),
});

const boundHostPort = (
  bindings: ReadonlyArray<{ HostPort?: string }> | null | undefined,
): number | undefined => {
  for (const binding of bindings ?? []) {
    if (!binding.HostPort) continue;
    const port = Number.parseInt(binding.HostPort, 10);
    if (Number.isInteger(port) && port > 0) return port;
  }
  return undefined;
};

const toPortAttributes = (info: Docker.Container): Record<string, number> => {
  const ports: Record<string, number> = {};
  for (const [internal, bindings] of Object.entries(
    info.HostConfig.PortBindings ?? {},
  )) {
    const port = boundHostPort(bindings);
    if (port !== undefined) ports[internal] = port;
  }
  for (const [internal, bindings] of Object.entries(
    info.NetworkSettings.Ports ?? {},
  )) {
    const port = boundHostPort(bindings);
    if (port !== undefined) ports[internal] = port;
  }
  return ports;
};

const isRandomHostPort = (external: number | string): boolean =>
  Number.parseInt(String(external), 10) === 0;

const normalizeEnvironment = (
  environment: Record<string, string | Redacted.Redacted<string>> | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment ?? {}).map(([key, value]) => [
      key,
      Redacted.isRedacted(value) ? Redacted.value(value) : value,
    ]),
  );

const toSeconds = (input: Duration.Input | undefined): number | undefined =>
  input !== undefined
    ? Math.round(Duration.toMillis(Duration.fromInputUnsafe(input)) / 1000)
    : undefined;

const normalizeDuration = (
  input: Duration.Input | undefined,
): string | undefined => {
  if (!input) return undefined;
  const duration = Duration.fromInputUnsafe(input);
  return `${Duration.toNanosUnsafe(duration).toString()}ns`;
};

const systemError = (input: {
  _tag: SystemErrorTag;
  args: Array<string>;
  description?: string;
  cause?: unknown;
}): PlatformError =>
  new PlatformError(
    new SystemError({
      _tag: input._tag,
      module: "Docker",
      method: input.args.slice(0, 2).join("."),
      pathOrDescriptor: input.args.join(" "),
      description: input.description,
      cause: input.cause,
    }),
  );
