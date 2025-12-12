import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { PostgresConfig } from "../config/postgres";

export const PostgresClientLive = Layer.unwrapEffect(
  Effect.map(PostgresConfig, (config) =>
    PgClient.layer({ ...config, })
  )
);
