import { Config } from "effect";

export const PostgresConfig = Config.all({
  host: Config.string("LAB_POSTGRES_HOST").pipe(Config.withDefault("localhost")),
  port: Config.integer("LAB_POSTGRES_PORT").pipe(Config.withDefault(5432)),
  database: Config.string("LAB_POSTGRES_DATABASE"),
  username: Config.string("LAB_POSTGRES_USER"),
  password: Config.redacted(Config.string("LAB_POSTGRES_PASSWORD")),
});
