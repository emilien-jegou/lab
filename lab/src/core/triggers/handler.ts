// Trigger handler contracts: a payload-consuming effect or an executable object.
import { Effect } from 'effect';

export type Executable<I, A, E, R> = {
  readonly execute: (payload: I) => Effect.Effect<A, E, R>;
};

export type TriggerHandler<I, A, E, R> =
  | ((payload: I) => Effect.Effect<A, E, R>)
  | Executable<I, A, E, R>;
