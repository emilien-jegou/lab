// infra/src/config.ts
import { Config, Redacted } from "effect";

export const HomeLabConfig = Config.all({
  dataDir: Config.String("DATA_DIR").pipe(Config.withDefault("./__internal")),

  // OpenObserve Dashboard Root Credentials
  openobserve: Config.all({
    rootEmail: Config.String("ZO_ROOT_USER_EMAIL").pipe(Config.withDefault("admin@example.com")),
    rootPassword: Config.Redacted("ZO_ROOT_USER_PASSWORD").pipe(
      Config.withDefault(Redacted.make("ChangeMe123!"))
    ),
  }),

});
