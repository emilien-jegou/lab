import { ClusterWorkflowEngine } from "@effect/cluster"
import { BunClusterSocket } from "@effect/platform-bun"
import { Layer } from "effect"
import { PostgresClientLive } from "../services/postgres"

export const WorkflowEngineLayer = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(BunClusterSocket.layer()),
  Layer.provideMerge(PostgresClientLive)
)
