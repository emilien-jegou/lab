import { Schema } from "effect"

export class AppError extends Schema.TaggedError<AppError>("AppError")("AppError", {
  message: Schema.String
}) {}
