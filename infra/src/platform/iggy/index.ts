// infra/src/platform/iggy/index.ts
import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import { EndpointHandle } from "../../gateway/ingress";
import { resolveServiceDataPath } from "../../paths";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";

export interface IggyProps {
  readonly username?: string;
  readonly password?: string | Redacted.Redacted<string>;
  readonly dataDir?: string;
}

export interface IggyHandle {
  readonly endpoint: EndpointHandle;
  readonly httpEndpoint: EndpointHandle;
  readonly tcpEndpoint: EndpointHandle;
  readonly user: string;
  readonly pass: Redacted.Redacted<string>;
}

export const Iggy = (name: string, props: IggyProps = {}) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;
    const dataVolume = props.dataDir ?? `${name}-data`;
    const username = props.username ?? "iggy";

    const password = yield* Secret.fromNullable(
      props.password,
      secrets.get("iggy", "password"),
    );

    yield* Docker.Container(name, {
      image: "apache/iggy:0.9.0-edge.8",
      name,
      networks: [{ name: net.name, aliases: ["iggy", name.toLowerCase(), name] }],
      start: true,
      restart: "unless-stopped",
      privileged: true,
      securityOpt: ["seccomp=unconfined"],
      capAdd: ["SYS_NICE"],
      ulimits: ["memlock=-1:-1"],
      environment: {
        IGGY_HTTP_ENABLED: "true",
        IGGY_HTTP_ADDRESS: "0.0.0.0:3000",
        IGGY_TCP_ENABLED: "true",
        IGGY_TCP_ADDRESS: "0.0.0.0:8090",
        IGGY_ROOT_USERNAME: username,
        IGGY_ROOT_PASSWORD: password.redacted,
        IGGY_NODE_ADVERTISED_ADDRESS: "iggy",
      },
      volumes: [{ hostPath: dataVolume, containerPath: "/app/local_data" }],
      healthcheck: {
        cmd: "bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/3000' || exit 1",
        interval: "10 seconds",
        timeout: "3 seconds",
        retries: 5,
      },
    });

    const httpEndpoint = { host: "iggy", port: 3000 };

    return {
      endpoint: httpEndpoint,
      httpEndpoint,
      tcpEndpoint: { host: "iggy", port: 8090 },
      user: username,
      pass: password.redacted,
    } satisfies IggyHandle;
  });
