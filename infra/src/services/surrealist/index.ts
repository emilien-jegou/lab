import * as Docker from "../../internal/docker";
import { Effect } from "effect";
import { SurrealHandle } from "../../platform/surrealdb";
import { PrivateServiceHandle } from "../auth-proxy";
import { getStackNetwork } from "../../link";

export interface SurrealistProps {
  readonly database: SurrealHandle;
}

export const Surrealist = (name: string, props: SurrealistProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();

    yield* Docker.Container(name, { start: true,
      image: "docker.io/surrealdb/surrealist:latest",
      name,
      networks: [{ name: net.name, aliases: [name] }],
    });

    return { name, endpoint: { host: name, port: 8080 } } satisfies PrivateServiceHandle;
  });
