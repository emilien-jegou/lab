// infra/src/platform/vector/index.ts
import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import { EndpointHandle } from "../../gateway/ingress";
import { OpenObserveHandle } from "../openobserve";
import { getStackNetwork } from "../../link";

export interface VectorProps {
  readonly sink: OpenObserveHandle;
  readonly dataDir?: string;
}

export interface VectorHandle {
  readonly endpoint: EndpointHandle;
  readonly ingestEndpoint: EndpointHandle;
  readonly streamEndpoint: EndpointHandle;
}

export const Vector = (name: string, props: VectorProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const dataVolume = props.dataDir ?? `${name}-data`;
    const pass = Redacted.value(props.sink.auth.pass);

    const renderedConfig = `
data_dir: /var/lib/vector

api:
  enabled: true
  address: "0.0.0.0:8688"

sources:
  app_in:
    type: http_server
    address: "0.0.0.0:8686"
    encoding: json
    strict_path: false

transforms:
  normalize:
    type: remap
    inputs:
      - app_in
    source: |
      if !exists(.timestamp) {
        .timestamp = to_unix_timestamp(now(), unit: "milliseconds")
      }
      if !exists(._timestamp) {
        ._timestamp = to_unix_timestamp(now(), unit: "microseconds")
      }
      if !exists(.source) {
        .source = "lab"
      }

sinks:
  openobserve_out:
    type: http
    inputs:
      - normalize
    uri: "${props.sink.internalUrl}/api/default/default/_json"
    method: post
    auth:
      strategy: basic
      user: "${props.sink.auth.user}"
      password: "${pass}"
    encoding:
      codec: json
    healthcheck:
      enabled: false

  websocket_out:
    type: websocket
    inputs:
      - normalize
    uri: "ws://lab:8687"
    encoding:
      codec: json
    healthcheck:
      enabled: false
    buffer:
      type: disk
      max_size: 1048576000
      when_full: drop_newest
`.trim();

    yield* Docker.Container(name, {
      start: true,
      restart: "unless-stopped",
      image: "docker.io/timberio/vector:nightly-alpine",
      name,
      networks: [{ name: net.name }],
      environment: {
        VECTOR_CONFIG: renderedConfig,
      },
      entrypoint: ["/bin/sh", "-c"],
      command: [
        `mkdir -p /etc/vector && printf "%s\\n" "$VECTOR_CONFIG" > /etc/vector/vector.yaml && exec vector -c /etc/vector/vector.yaml`,
      ],
      volumes: [{ hostPath: dataVolume, containerPath: "/var/lib/vector" }],
    });

    const endpoint: EndpointHandle = { host: name, port: 8686 };

    return {
      endpoint,
      ingestEndpoint: endpoint,
      streamEndpoint: { host: name, port: 8687 },
    } satisfies VectorHandle;
  });
