import { Effect, Schema } from "effect"
import { Layer, Option } from "effect"
import { EmailConfig } from "../../config/email"
import { EmailProvider } from "./provider"
import { FakeEmailProvider } from "./fake"
import { ResendEmailProviderLive } from "./resend"

export class Email extends Schema.Class<Email>("Email")({
  to: Schema.String,
  subject: Schema.String,
  body: Schema.String
}) { }


export class EmailService extends Effect.Service<EmailService>()("EmailService", {
  accessors: true,
  effect: Effect.gen(function*() {
    const emailProvider = yield* EmailProvider

    return {
      send: (email: Email): Effect.Effect<void, Error> => emailProvider.send(email)
    }
  }),
}) { }

export const EmailProviderLive = Layer.unwrapEffect(
  Effect.gen(function*() {
    const config = yield* EmailConfig;

    if (Option.isSome(config.resendApiKey)) {
      return ResendEmailProviderLive
    } else {
      return FakeEmailProvider
    }
  })
)
