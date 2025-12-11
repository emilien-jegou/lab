import { Context, Schema, Effect } from "effect"

export class Email extends Schema.Class<Email>("Email")({
  to: Schema.String,
  subject: Schema.String,
  body: Schema.String
}) { }


export class EmailProvider extends Context.Tag("EmailProvider")<
  EmailProvider,
  {
    readonly send: (email: Email) => Effect.Effect<void, Error>
  }
>() { }
