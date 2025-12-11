import { Workflow } from "@effect/workflow"
import { Effect, Layer, Schema } from "effect"
import { webhookTrigger } from "../core/triggers/webhook"
import { sendEmail, SendEmailError } from "../tasks/send-email"
import { EmailService } from "../services/email"

// 1. Schema
export const BaserowWebhookSchema = Schema.Struct({
  event_id: Schema.String,
  table_id: Schema.Number,
  database_id: Schema.Number,
  workspace_id: Schema.Number,
  event_type: Schema.String,
  items: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      order: Schema.Number,
      table_id: Schema.String,
    })
  )
})

// 2. Workflow Definition
export const BaserowWorkflow = Workflow.make({
  name: "BaserowUpdater",
  success: Schema.Void,
  error: SendEmailError,
  payload: BaserowWebhookSchema,
  idempotencyKey: (payload) => payload.event_id
})

// 3. Workflow Implementation
const BaserowWorkflowImpl = BaserowWorkflow.toLayer(
  Effect.fn(function*(payload) {
    yield* Effect.log(`Starting workflow.`)
    for (const item of payload.items) {
      // Create a nested effect for processing each item
      const itemProcessing = Effect.gen(function*() {
        const uniqueItemId = `${payload.event_id}-${item.id}`
        // Annotate with item-specific info
        yield* Effect.annotateCurrentSpan({
          "item.id": item.id,
          "item.name": item.name
        })

        yield* Effect.log(`Start email sent for ${item.id}.`)
        yield* sendEmail({
          id: uniqueItemId,
          to: "admin@baserow.io"
        }).pipe(
          BaserowWorkflow.withCompensation(
            Effect.fn(function*() {
              yield* Effect.log(`Compensating activity SendEmail for ${uniqueItemId}`)
            })
          ),
          Effect.withSpan("activity.sendEmail") // Span for the activity
        )

        yield* Effect.log(`Item ${item.id} processing complete.`)
      })

      // Execute the item processing logic within its own span
      yield* itemProcessing.pipe(Effect.withSpan(`workflow.item.processing`))
    }

    yield* Effect.log("Baserow Webhook Workflow Fully Completed")
  })
)

export const BaserowWorkflowLive = Layer.provide(BaserowWorkflowImpl, EmailService.Default)

export const BaserowAgentRoute = webhookTrigger('/hooks/baserow-update')
  .schema(BaserowWebhookSchema)
  .workflow(BaserowWorkflow);
