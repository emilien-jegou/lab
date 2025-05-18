import { Layer, Redacted, Effect } from "effect";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeSdk, Tracer } from "@effect/opentelemetry";
import { OpenObserveConfig } from "../../config/openobserve";
import { TelemetryConfig } from "../../config/telemetry";

export const OpenObserveTelemetryLive = Layer.unwrapEffect(
  Effect.gen(function*() {
    const isEnabled = yield* TelemetryConfig;
    if (!isEnabled) {
      return Layer.empty;
    }

    const o2Config = yield* OpenObserveConfig;
    const basicAuth = btoa(`${o2Config.username}:${Redacted.value(o2Config.password)}`);

    // Standard OpenObserve OTLP traces endpoint
    const tracesUrl = `${o2Config.url.replace(/\/+$/, "")}/api/${o2Config.organization}/v1/traces`;

    // Strictly validate the stream name (fallback to config default "lab_traces")
    const targetStream =
      o2Config.traceStream && o2Config.traceStream.trim() !== "" && o2Config.traceStream !== "undefined"
        ? o2Config.traceStream.trim()
        : "lab_traces";

    const NodeSdkLive = NodeSdk.layer(() => ({
      resource: {
        serviceName: "lab",
        serviceVersion: "1.0.0",
        attributes: {
          "deployment.environment": process.env.LAB_NODE_ENV ?? "development",
        },
      },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: tracesUrl,
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "stream-name": targetStream,
          },
        }),
        {
          scheduledDelayMillis: 1000,
          maxExportBatchSize: 64,
        }
      ),
    }));

    return Tracer.layerGlobal.pipe(Layer.provide(NodeSdkLive));
  })
);
