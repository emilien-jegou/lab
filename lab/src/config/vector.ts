import { Config } from "effect";

export const VectorConfig = Config.all({
  ingestUrl: Config.string("LAB_VECTOR_INGEST_URL"),
});
