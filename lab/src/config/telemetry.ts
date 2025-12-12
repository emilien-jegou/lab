import { Config } from "effect"

export const TelemetryConfig = Config.boolean("LAB_TELEMETRY_ENABLED").pipe(
  Config.withDefault(false)
)
