import * as Docker from "../../internal/docker";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import { makePublicEndpoint, PublicEndpoint, SecuredService } from "../../gateway/ingress";
import { SurrealDatabaseHandle } from "../../platform/surrealdb";
import { S3BucketHandle } from "../../platform/garage";
import { ValkeyHandle } from "../../platform/valkey";
import { IggyHandle } from "../../platform/iggy";
import { ImgProxyHandle } from "../../platform/imgproxy";
import { VectorHandle } from "../../platform/vector";
import { OpenObserveHandle } from "../../platform/openobserve";
import { getStackNetwork } from "../../link";
import { resolveProjectPath } from "../../paths";

export interface LabProps {
  readonly appDir: string;
  readonly storage: S3BucketHandle;
  readonly cache: ValkeyHandle;
  readonly events: IggyHandle;
  readonly db: SurrealDatabaseHandle;
  readonly media: ImgProxyHandle;
  readonly telemetry: VectorHandle;
  readonly cloud: SecuredService;
  readonly observability: OpenObserveHandle;
}

export interface LabHandle {
  readonly name: string;
  readonly endpoint: { readonly host: string; readonly port: number };
  readonly PublicEndpoint: PublicEndpoint<LabHandle>;
}

export const Lab = (name: string, props: LabProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const dataVolume = `${name}-data`;

    yield* Docker.Container(name, {
      image: "docker.io/oven/bun:latest",
      name,
      networks: [{ name: net.name, aliases: ["lab", "labapp", name.toLowerCase(), name] }],
      start: true,
      init: true,
      workingDir: "/app",
      restart: "unless-stopped",
      command: [
        "bash",
        "-c",
        "(bun install || true) && until bun run dev; do echo 'Waiting for backing services... retrying in 2s'; sleep 2; done",
      ],
      environment: {
        LAB_NODE_ENV: "development",
        LAB_FORCE_COLOR: "1",
        LAB_SURREALDB_HOST: props.db.url,
        LAB_SURREALDB_NAMESPACE: props.db.namespace,
        LAB_SURREALDB_DATABASE: props.db.database,
        LAB_SURREALDB_USER: props.db.user,
        LAB_SURREALDB_PASSWORD: props.db.password,
        VALKEY_HOST: props.cache.endpoint.host,
        VALKEY_PORT: props.cache.endpoint.port.toString(),
        VALKEY_PASSWORD: props.cache.password,
        LAB_IGGY_URL: `http://${props.events.httpEndpoint.host}:${props.events.httpEndpoint.port}`,
        LAB_IGGY_STREAM: "lab",
        LAB_IGGY_USER: props.events.user,
        LAB_IGGY_PASSWORD: props.events.pass,
        S3_ENDPOINT: props.storage.s3Url,
        S3_BUCKET: props.storage.bucket,
        AWS_ACCESS_KEY_ID: props.storage.accessKey,
        AWS_SECRET_ACCESS_KEY: props.storage.secretKey,
        AWS_REGION: props.storage.region,
        IMGPROXY_URL: `http://${props.media.endpoint.host}:${props.media.endpoint.port}`,
        OXICLOUD_URL: `http://${props.cloud.endpoint.host}:${props.cloud.endpoint.port}`,
      },
      volumes: [
        { hostPath: props.appDir, containerPath: "/app" },
        { hostPath: dataVolume, containerPath: "/data" },
      ],
    });

    const endpoint = { host: "lab", port: 3000 };
    const handle: LabHandle = {
      name,
      endpoint,
      get PublicEndpoint() {
        return makePublicEndpoint(handle, endpoint);
      },
    };
    return handle;
  });
