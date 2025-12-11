import { DurableClock, DurableDeferred, Workflow } from "@effect/workflow"
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
    // The main workflow logic wrapped in a generator
    const workflowLogic = Effect.gen(function*() {
      yield* Effect.log(`Starting Baserow Workflow for event: ${payload.event_type}`)
      // Annotate the current span with payload details for better context
      yield* Effect.annotateCurrentSpan({
        "baserow.event_id": payload.event_id,
        "baserow.event_type": payload.event_type,
        "baserow.item_count": payload.items.length
      })

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
          // --- A. Run Activity with Compensation ---
          yield* sendEmail({
            id: uniqueItemId,
            to: "admin@baserow.io"
          }).pipe(
            BaserowWorkflow.withCompensation(
              Effect.fn(function*() {
                yield* Effect.log(`Compensating activity SendEmail for ${uniqueItemId}`)
                // Add actual compensation logic here (e.g. send "Undo" email)
              })
            ),
            Effect.withSpan("activity.sendEmail") // Span for the activity
          )

          // --- B. Sleep ---
          yield* Effect.log(`Email sent for ${item.id}. Sleeping...`)
          yield* DurableClock.sleep({
            name: `post-email-sleep-${item.id}`,
            duration: "2 seconds"
          }).pipe(
            Effect.withSpan("durable.sleep") // Span for the sleep duration
          )

          // --- C. Wait for Signal ---
          const emailTriggerId = `EmailTrigger-${uniqueItemId}`
          const EmailTrigger = DurableDeferred.make(emailTriggerId)
          const token = yield* DurableDeferred.token(EmailTrigger)

          // Simulate callback
          yield* DurableDeferred.succeed(EmailTrigger, {
            token,
            value: void 0
          }).pipe(
            Effect.delay("1 second"),
            Effect.forkDaemon
          )

          yield* DurableDeferred.await(EmailTrigger).pipe(
            Effect.withSpan("durable.await") // Span for awaiting the signal
          )
          yield* Effect.log(`Item ${item.id} processing complete.`)
        })

        // Execute the item processing logic within its own span
        yield* itemProcessing.pipe(Effect.withSpan(`workflow.item.processing`))
      }

      yield* Effect.log("Baserow Webhook Workflow Fully Completed")
    })

    // Execute the main logic and wrap it with the parent span for this workflow
    return yield* workflowLogic.pipe(Effect.withSpan("workflow.BaserowUpdater"))
  })
)

export const BaserowWorkflowLive = Layer.provide(BaserowWorkflowImpl, EmailService.Default)

export const BaserowAgentRoute = webhookTrigger('/hooks/baserow-update')
  .schema(BaserowWebhookSchema)
  .workflow(BaserowWorkflow);
