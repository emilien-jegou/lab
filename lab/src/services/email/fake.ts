import { Console, Layer } from "effect"
import { Email, EmailProvider } from "./provider"

export const FakeEmailProvider = Layer.succeed(
  EmailProvider,
  EmailProvider.of({
    send: (email: Email) => Console.log(`(Fake) Email sent: ${JSON.stringify(email, null, 2)}`)
  })
)
