// Tagged errors for the Valkey key-value service.
import { Data } from 'effect';

export class ValkeyConnectionError extends Data.TaggedError('ValkeyConnectionError')<{
  readonly message: string;
  readonly cause?: unknown;
}> { }

export class ValkeyCommandError extends Data.TaggedError('ValkeyCommandError')<{
  readonly command: string;
  readonly message: string;
  readonly cause?: unknown;
}> { }

export class ValkeyDecodeError extends Data.TaggedError('ValkeyDecodeError')<{
  readonly key: string;
  readonly namespace: string;
  readonly message: string;
  readonly issue: unknown;
}> { }

export class ValkeyKeyNotFoundError extends Data.TaggedError('ValkeyKeyNotFoundError')<{
  readonly key: string;
  readonly namespace: string;
  readonly message: string;
}> { }

export type ValkeyError =
  | ValkeyConnectionError
  | ValkeyCommandError
  | ValkeyDecodeError
  | ValkeyKeyNotFoundError;
