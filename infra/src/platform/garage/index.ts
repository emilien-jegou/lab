// infra/src/platform/garage/index.ts
import * as Docker from "../../internal/docker";
import { Script } from "../../internal/script/Script";
import { Effect, Redacted } from "effect";
import * as path from "node:path";
import { EndpointHandle } from "../../gateway/ingress";
import { resolveServiceDataPath } from "../../paths";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";
import { StorageInput } from "../../storage";

export interface S3EngineProps {
  readonly storage?: StorageInput;
  readonly dataDir?: string;
}

export interface S3EngineHandle {
  readonly _tag: "S3Engine";
  readonly containerName: string;
  readonly s3Endpoint: EndpointHandle;
  readonly s3Url: string;
  readonly region: string;
}

export interface S3BucketProps {
  readonly engine: S3EngineHandle;
  readonly accessKey?: string | Redacted.Redacted<string>;
  readonly secretKey?: string | Redacted.Redacted<string>;
}

export interface S3BucketHandle {
  readonly _tag: "S3Bucket";
  readonly bucket: string;
  readonly s3Endpoint: EndpointHandle;
  readonly s3Url: string;
  readonly accessKey: string;
  readonly secretKey: Redacted.Redacted<string>;
  readonly region: string;
}

// TODO: fix explicit use of entrypoints
export const S3 = {
  Engine: (name: string, props: S3EngineProps = {}) =>
    Effect.gen(function* () {
      const net = yield* getStackNetwork();
      const confDir = yield* resolveServiceDataPath(name, props.dataDir, "conf");
      const configFilePath = path.join(confDir, "garage.toml");

      const generatedToml = `
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"

[s3_web]
bind_addr = "[::]:3902"
root_domain = ".web.garage.localhost"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "garage-admin-token-secret"
`.trim();

      const metaVolume = `${name}-meta`;
      const dataVolume = `${name}-data`;

      // Materialize garage.toml as a tracked resource (was inline container `content`)
      const garageConfig = yield* Docker.ConfigFile(`${name}-toml`, {
        path: configFilePath,
        content: generatedToml,
      });

      yield* Docker.Container(name, {
        start: true,
        restart: "unless-stopped",
        image: "docker.io/dxflrs/garage:v2.3.0",
        name,
        networks: [{ name: net.name, aliases: ["garage", "garage-engine", name] }],
        command: ["/garage", "server", "--single-node"],
        labels: {
          // Replaces this container whenever the rendered garage.toml changes.
          "homelab.config-hash.garage-toml": garageConfig.hash,
        },
        volumes: [
          {
            hostPath: garageConfig.path,
            containerPath: "/etc/garage.toml",
          },
          { hostPath: metaVolume, containerPath: "/var/lib/garage/meta" },
          { hostPath: dataVolume, containerPath: "/var/lib/garage/data" },
        ],
      });

      const s3Endpoint: EndpointHandle = {
        host: name,
        port: 3900,
        protocol: "http",
      };

      return {
        _tag: "S3Engine",
        containerName: name,
        s3Endpoint,
        s3Url: `http://${name}:3900`,
        region: "garage",
      } satisfies S3EngineHandle;
    }),

  Bucket: (bucketName: string, props: S3BucketProps) =>
    Effect.gen(function* () {
      const secrets = yield* SecretStore;
      const normalizedBucket = bucketName.toLowerCase();

      const secretKey = yield* Secret.fromNullable(
        props.secretKey,
        secrets.get(`garage/${normalizedBucket}`, "secret_key", { bytes: 32, encoding: "hex" }),
      );

      const accessKey = yield* Secret.fromNullable(
        props.accessKey,
        secrets.get(`garage/${normalizedBucket}`, "access_key", { bytes: 12, encoding: "hex" }),
      );
      const formattedAccessKey = accessKey.value.startsWith("GK")
        ? accessKey.value
        : `GK${accessKey.value}`;

      yield* Script(`${props.engine.containerName}-${normalizedBucket}-provision`, {
        params: {
          containerName: props.engine.containerName,
          bucket: normalizedBucket,
          accessKey: formattedAccessKey,
          secretKey: secretKey.value,
        },
        run: ({ containerName, bucket, accessKey, secretKey }) =>
          Effect.gen(function* () {
            const docker = yield* Docker.Docker;

            const inspect = yield* docker.container
              .inspect(containerName)
              .pipe(Effect.orElseSucceed(() => undefined));

            if (!inspect || !inspect.State.Running) {
              return;
            }

            yield* docker.run([
              "container", "exec", containerName,
              "/garage", "bucket", "create", bucket,
            ]).pipe(Effect.ignore);

            yield* docker.run([
              "container", "exec", containerName,
              "/garage", "key", "import", accessKey, secretKey, "--name", `${bucket}-key`,
            ]).pipe(Effect.ignore);

            yield* docker.run([
              "container", "exec", containerName,
              "/garage", "bucket", "allow",
              "--read", "--write",
              bucket,
              "--key", `${bucket}-key`,
            ]).pipe(Effect.ignore);
          }),
      });

      return {
        _tag: "S3Bucket",
        bucket: normalizedBucket,
        s3Endpoint: props.engine.s3Endpoint,
        s3Url: props.engine.s3Url,
        accessKey: formattedAccessKey,
        secretKey: secretKey.redacted,
        region: props.engine.region,
      } satisfies S3BucketHandle;
    }),
};
