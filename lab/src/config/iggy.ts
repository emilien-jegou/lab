// lab/src/config/iggy.ts
import { Config } from "effect";

export const IggyConfig = Config.all({
  url: Config.string("LAB_IGGY_URL").pipe(Config.withDefault("http://iggy:3000")),
  streamId: Config.string("LAB_IGGY_STREAM").pipe(Config.withDefault("lab")),
  username: Config.string("LAB_IGGY_USER").pipe(Config.withDefault("iggy")),
  password: Config.redacted(Config.string("LAB_IGGY_PASSWORD").pipe(Config.withDefault("iggy"))),
});
