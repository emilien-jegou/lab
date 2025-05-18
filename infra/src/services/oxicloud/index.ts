// infra/src/services/oxicloud/index.ts
import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import { SecuredService, Entrypoint } from "../../gateway/ingress";
import { Postgres, PostgresHandle } from "../../platform/postgres";
import { S3BucketHandle } from "../../platform/garage";
import { KanidmHandle } from "../../platform/kanidm";
import { resolveServiceDataPath } from "../../paths";
import { getStackNetwork } from "../../link";

export interface OxiCloudProps {
  readonly entrypoint: Entrypoint;
  readonly database?: PostgresHandle;
  readonly storage: S3BucketHandle;
  readonly oidc: KanidmHandle;
  readonly dataDir?: string;
}

export interface OxiCloudHandle extends SecuredService {
  readonly database: PostgresHandle;
}

export const OxiCloud = (name: string, props: OxiCloudProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const dataVolume = props.dataDir ?? `${name}-data`;

    const oidcClient = yield* props.oidc.Client({
      id: "oxicloud",
      name: "Oxicloud",
      origin: props.entrypoint.origin,
      redirectUri: props.entrypoint.url("/api/auth/oidc/callback"),
    });

    const database = yield* (props.database
      ? Effect.succeed(props.database)
      : Postgres(`${name}-postgres`, {
          dataDir: props.dataDir,
        }));

    yield* Docker.Container(name, {
      image: "docker.io/diocrafts/oxicloud:latest",
      name,
      networks: [{ name: net.name, aliases: ["oxicloud", name.toLowerCase(), name] }],
      start: true,
      restart: "unless-stopped",
      environment: {
        OXICLOUD_SERVER_HOST: "0.0.0.0",
        OXICLOUD_BASE_URL: props.entrypoint.origin,
        OXICLOUD_OIDC_FRONTEND_URL: props.entrypoint.origin,
        OXICLOUD_OIDC_REDIRECT_URI: props.entrypoint.url("/api/auth/oidc/callback"),
        OXICLOUD_DB_CONNECTION_STRING: database.connectionString,
        MIMALLOC_PURGE_DELAY: "0",
        OXICLOUD_AUTH_METHODS: "oidc",
        OXICLOUD_AUTH_POLICIES: "auto_redirect_if_standalone_oidc",
        OXICLOUD_OIDC_ENABLED: "true",
        OXICLOUD_OIDC_PROVIDER_NAME: "Kanidm",
        OXICLOUD_OIDC_ISSUER_URL: `${props.oidc.issuerUrl}/oauth2/openid/oxicloud`,
        OXICLOUD_OIDC_CLIENT_ID: oidcClient.clientId,
        OXICLOUD_OIDC_CLIENT_SECRET: Redacted.value(oidcClient.clientSecret),
        OXICLOUD_OIDC_SCOPES: "openid profile email",
        OXICLOUD_OIDC_AUTO_PROVISION: "true",
      },
      volumes: [{ hostPath: dataVolume, containerPath: "/app/storage" }],
      healthcheck: {
        cmd: "wget -qO- http://127.0.0.1:8086/ready || exit 1",
        interval: "15 seconds",
        timeout: "5 seconds",
        retries: 3,
      },
    });

    return {
      _tag: "SecuredService",
      name,
      endpoint: { host: "oxicloud", port: 8086 },
      database,
    } satisfies OxiCloudHandle;
  });
