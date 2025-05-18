import { Config } from "effect";

export const SurrealConfig = Config.all({
  url: Config.string("LAB_SURREALDB_HOST"),
  namespace: Config.string("LAB_SURREALDB_NAMESPACE").pipe(Config.withDefault("app")),
  database: Config.string("LAB_SURREALDB_DATABASE").pipe(Config.withDefault("app")),
  token: Config.option(Config.string("LAB_SURREALDB_TOKEN")),
  username: Config.option(Config.string("LAB_SURREALDB_USER")),
  password: Config.option(Config.redacted(Config.string("LAB_SURREALDB_PASSWORD"))),
});

