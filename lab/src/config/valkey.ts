import { Config } from "effect";

export const ValkeyConfig = Config.all({
  host: Config.string("VALKEY_HOST").pipe(Config.withDefault("valkey")),
  port: Config.integer("VALKEY_PORT").pipe(Config.withDefault(6379)),
  password: Config.option(Config.redacted(Config.string("VALKEY_PASSWORD"))),
  db: Config.integer("VALKEY_DB").pipe(Config.withDefault(0)),
});
