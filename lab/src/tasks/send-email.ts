import { Effect, Schema } from "effect"
import { Email, EmailService } from "../services/email"

// Define a specific error for this task for better error handling.
export class SendEmailError extends Schema.TaggedError<SendEmailError>()(
  "SendEmailError",
  {
    message: Schema.String
  }
) { }

// Define the input schema for the sendEmail activity.
const SendEmailInput = Schema.Struct({
  id: Schema.String,
  to: Schema.String
})

export const sendEmail = (
  input: Schema.Schema.Type<typeof SendEmailInput>
) =>
  Effect.gen(function*() {
    const emailService = yield* EmailService
    yield* Effect.log(`Sending email for ID: ${input.id}`)
    return yield* emailService.send(
      new Email({
        to: input.to,
        subject: `Update for ${input.id}`,
        body: "This is a notification about your workflow item."
      })
    )
  }).pipe(
    Effect.mapError(
      (error) => new SendEmailError({ message: error.message })
    )
  )
