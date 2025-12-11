import { Effect, Layer, Redacted, Option } from "effect"
import { Email, EmailProvider } from "./provider"
import { EmailConfig } from "../../config/email"
import { Resend } from "resend"

export const ResendEmailProviderLive = Layer.effect(
  EmailProvider,
  Effect.gen(function*() {
    const config = yield* EmailConfig

    // Check if both required config values are present. If not, fail the layer creation.
    if (Option.isNone(config.resendApiKey) || Option.isNone(config.defaultFrom)) {
      return yield* Effect.fail(
        new Error("Resend provider is missing RESEND_API_KEY or EMAIL_DEFAULT_FROM")
      )
    }

    // Since we've checked, we can safely get the values.
    const resend = new Resend(Redacted.value(config.resendApiKey.value))
    const defaultFrom = config.defaultFrom.value

    return EmailProvider.of({
      send: (email: Email) =>
        Effect.tryPromise({
          try: () =>
            resend.emails.send({
              from: defaultFrom,
              to: email.to,
              subject: email.subject,
              html: email.body
            }),
          catch: (error) => new Error(`Failed to send email via Resend: ${(error as Error).message}`)
        }).pipe(Effect.asVoid)
    })
  })
)
