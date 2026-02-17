import { Workflow } from "@effect/workflow"
import { Effect, Layer, Schema } from "effect"
import { Webhook } from "~/core/triggers"

const UserSignupSchema = Schema.Struct({ id: Schema.String })

const OnboardingWorkflow = Workflow.make({
  name: "OnboardingWorkflow",
  success: Schema.Void,
  error: Schema.Never,
  payload: UserSignupSchema,
  idempotencyKey: (payload) => payload.id
})

const OnboardingWorkflowLive = OnboardingWorkflow.toLayer(
  Effect.fn(function*(payload) {
    yield* Effect.log(`[Workflow] Provisioning resources for ${JSON.stringify(payload)}...`)
  })
)

const UserSignupTriggerLive = Webhook.post("/demo")
  .json(UserSignupSchema)
  .bindAsLayer(OnboardingWorkflow, 'kitchen-sink')

export const KitchenSinkLive = Layer.mergeAll(
  OnboardingWorkflowLive,
  UserSignupTriggerLive
)
