import { NodeSdk } from "@effect/opentelemetry"
import { BatchSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base"
import { Effect, Layer } from "effect"
import { TelemetryConfig } from "../config/telemetry"

const NodeSdkLive = NodeSdk.layer(() => ({
  resource: { serviceName: "effect-ts-app" },
  spanProcessor: new BatchSpanProcessor(new ConsoleSpanExporter())
}))

export const TelemetryLive = Layer.suspend(() =>
  TelemetryConfig.pipe(
    Effect.map((enabled) => (enabled ? NodeSdkLive : Layer.empty)),
    Layer.unwrapEffect
  )
)
