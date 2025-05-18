// infra/src/services/materialious/index.ts
import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import { PrivateServiceHandle } from "../auth-proxy";
import { resolveServiceDataPath } from "../../paths";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";

export interface MaterialiousProps {
  readonly cookieSecret?: string | Redacted.Redacted<string>;
  readonly dataDir?: string;
}

export const Materialious = (name: string, props: MaterialiousProps = {}) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;
    const dataVolume = props.dataDir ?? `${name}-data`;

    const cookieSecret = yield* Secret.fromNullable(
      props.cookieSecret,
      secrets.get("materialious", "cookie_secret", { bytes: 32, encoding: "hex" }),
    );

    yield* Docker.Container(name, {
      start: true,
      restart: "unless-stopped",
      image: "docker.io/wardpearce/materialious-full:latest",
      name,
      networks: [{ name: net.name }],
      environment: {
        COOKIE_SECRET: cookieSecret.value,
        DATABASE_CONNECTION_URI: "sqlite:///materialious-data/materialious.db",
        PUBLIC_CAPTCHA_DISABLED: "true",
        PUBLIC_INTERNAL_AUTH: "true",
        PUBLIC_REQUIRE_AUTH: "false",
        PUBLIC_REGISTRATION_ALLOWED: "true",
        PUBLIC_QUICK_CONNECT: "false",
      },
      volumes: [{ hostPath: dataVolume, containerPath: "/materialious-data" }],
    });

    return {
      name,
      endpoint: { host: name, port: 3000 },
    } satisfies PrivateServiceHandle;
  });
