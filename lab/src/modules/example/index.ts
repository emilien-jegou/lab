import { Workflow } from "@effect/workflow"
import { Effect, Layer, Schema } from "effect"
import { webhook } from "~/core/triggers"
import { defineModule } from "~/core/system/module"

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

// Here is the clean approach you asked for:
export const ExampleLive = defineModule(
  "example",
  Layer.mergeAll(
    OnboardingWorkflowLive,
    webhook.post("/demo").json(UserSignupSchema).bind(OnboardingWorkflow)
  )
)
