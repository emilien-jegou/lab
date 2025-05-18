// lab/src/config/openobserve.ts
import { Config } from "effect";

export const OpenObserveConfig = Config.all({
  url: Config.string("LAB_OPENOBSERVE_URL"),
  organization: Config.string("LAB_OPENOBSERVE_ORG").pipe(Config.withDefault("default")),
  logStream: Config.string("LAB_OPENOBSERVE_LOG_STREAM").pipe(Config.withDefault("lab_logs")),
  traceStream: Config.string("LAB_OPENOBSERVE_TRACE_STREAM").pipe(Config.withDefault("lab_traces")),
  username: Config.string("LAB_OPENOBSERVE_USER"),
  password: Config.redacted(Config.string("LAB_OPENOBSERVE_PASSWORD")),
});
