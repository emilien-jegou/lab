import { Kanidm } from "./platform/kanidm";
import { OpenObserve } from "./platform/openobserve";
import { Vector } from "./platform/vector";
import { S3 } from "./platform/garage";
import { ImgProxy } from "./platform/imgproxy";
import { Valkey } from "./platform/valkey";
import { Iggy } from "./platform/iggy";
import { SurrealDB } from "./platform/surrealdb";
import { Postgres } from "./platform/postgres";

import { OxiCloud } from "./services/oxicloud";
import { Lab } from "./services/lab";
import { Surrealist } from "./services/surrealist";
import { Materialious } from "./services/materialious";
import { withOidcAuth } from "./services/auth-proxy";

import { Pingora } from "./gateway/pingora";

export const Infra = {
  Kanidm,
  OpenObserve,
  Vector,
  S3,
  ImgProxy,
  Valkey,
  Iggy,
  SurrealDB,
  Postgres,
};

export const Services = {
  OxiCloud,
  Lab,
  Surrealist,
  Materialious,
  withOidcAuth,
};

export const Gateway = {
  Pingora,
};
