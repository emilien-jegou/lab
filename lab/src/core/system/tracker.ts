import { Context, Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import { MessageBroker, type BrokerPayload } from "./broker"
import { SystemWorkflowBroker } from "./api";

export interface WorkflowRun {
  readonly id: string;
  readonly triggerType: string;
  readonly status: "running" | "completed" | "failed";
  readonly startTime: number;
  readonly endTime?: number;
  readonly error?: string;
  readonly meta: any;    // Added
  readonly payload: any; // Added
}

export interface RunFilters {
  readonly limit: number;
  readonly offset: number;
  readonly status?: string | null;
  readonly type?: string | null;
}

export class WorkflowTracker extends Context.Tag("WorkflowTracker")<
  WorkflowTracker,
  {
    readonly start: (triggerType: string, meta: any, payload: any) => Effect.Effect<string>;
    readonly complete: (id: string) => Effect.Effect<void>;
    readonly fail: (id: string, error: unknown) => Effect.Effect<void>;
    readonly getRuns: (filters: RunFilters) => Effect.Effect<WorkflowRun[]>;
    readonly countRuns: (filters: Omit<RunFilters, "limit" | "offset">) => Effect.Effect<number>;
  }
>() { }

export const WorkflowTrackerLive = Layer.effect(
  WorkflowTracker,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const brokerInstance = yield* MessageBroker

    yield* sql`
      CREATE TABLE IF NOT EXISTS system_workflow_runs (
        id VARCHAR(255) PRIMARY KEY,
        trigger_type VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        start_time BIGINT NOT NULL,
        end_time BIGINT,
        error TEXT,
        meta JSONB,
        payload JSONB
      )
    `.pipe(Effect.orDie)

    const sendWorkflowEvent = (event: BrokerPayload<typeof SystemWorkflowBroker>) =>
      SystemWorkflowBroker.publish(event).pipe(
        Effect.provideService(MessageBroker, brokerInstance),
        Effect.orDie
      )

    return {
      start: (triggerType, meta, payload) => Effect.gen(function*() {
        if (triggerType.startsWith("system-")) return `internal_${crypto.randomUUID()}`

        const id = crypto.randomUUID()

        yield* sendWorkflowEvent({
          action: "start",
          id,
          triggerType,
          meta,
          payload,
          timestamp: Date.now()
        })
        return id
      }),
      complete: (id) => Effect.gen(function*() {
        if (id.startsWith("internal_")) return
        yield* sendWorkflowEvent({ action: "complete", id, timestamp: Date.now() })
      }),
      fail: (id, error) => Effect.gen(function*() {
        if (id.startsWith("internal_")) return
        yield* sendWorkflowEvent({ action: "fail", id, error: String(error), timestamp: Date.now() })
      }),
      getRuns: (filters) => Effect.gen(function*() {
        let query = sql`SELECT * FROM system_workflow_runs WHERE 1=1`
        if (filters.status) query = sql`${query} AND status = ${filters.status}`
        if (filters.type) query = sql`${query} AND trigger_type = ${filters.type}`
        query = sql`${query} ORDER BY start_time DESC LIMIT ${filters.limit} OFFSET ${filters.offset}`
        const rows = yield* query.pipe(Effect.orDie)
        return rows.map((r: any) => ({
          id: r.id, triggerType: r.trigger_type, status: r.status,
          startTime: Number(r.start_time), endTime: r.end_time ? Number(r.end_time) : undefined,
          error: r.error ?? undefined,
          meta: r.meta, payload: r.payload
        }))
      }),
      countRuns: (filters) => Effect.gen(function*() {
        let query = sql`SELECT COUNT(*) as count FROM system_workflow_runs WHERE 1=1`
        if (filters.status) query = sql`${query} AND status = ${filters.status}`
        if (filters.type) query = sql`${query} AND trigger_type = ${filters.type}`
        const rows = yield* query.pipe(Effect.orDie)
        return Number((rows[0] as any)?.count || 0)
      })
    }
  })
)
