// infra/src/platform/imgproxy/index.ts
import * as Docker from "../../internal/docker";
import { Effect } from "effect";
import { EndpointHandle, makePublicEndpoint, PublicEndpoint } from "../../gateway/ingress";
import { S3BucketHandle } from "../garage";
import { getStackNetwork } from "../../link";

export interface ImgProxyProps {
  readonly storage: S3BucketHandle;
}

export interface ImgProxyHandle {
  readonly endpoint: EndpointHandle;
  readonly PublicEndpoint: PublicEndpoint<ImgProxyHandle>;
}

export const ImgProxy = (name: string, props: ImgProxyProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();

    yield* Docker.Container(name, { start: true,
      image: "docker.io/darthsim/imgproxy:latest",
      name,
      networks: [{ name: net.name, aliases: [name] }],
      environment: {
        IMGPROXY_USE_S3: "true",
        IMGPROXY_S3_ENDPOINT: props.storage.s3Url,
        AWS_ACCESS_KEY_ID: props.storage.accessKey,
        AWS_SECRET_ACCESS_KEY: props.storage.secretKey,
        AWS_REGION: props.storage.region,
      },
      restart: "unless-stopped",
      healthcheck: {
        cmd: ["imgproxy", "health"],
        interval: "10 seconds",
        timeout: "3 seconds",
        retries: 3,
      },
    });

    const endpoint: EndpointHandle = { host: name, port: 8080 };
    const handle: ImgProxyHandle = {
      endpoint,
      get PublicEndpoint() {
        return makePublicEndpoint(handle, endpoint);
      },
    };

    return handle;
  });
