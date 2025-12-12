import { Config } from "effect"

export const EmailConfig = Config.all({
  emailEnabled: Config.boolean("LAB_EMAIL_ENABLED").pipe(Config.withDefault(false)),
  resendApiKey: Config.option(Config.redacted("LAB_EMAIL_RESEND_API_KEY")),
  defaultFrom: Config.option(Config.string("LAB_EMAIL_DEFAULT_FROM"))
})
