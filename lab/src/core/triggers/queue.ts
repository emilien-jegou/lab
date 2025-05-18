// Trigger-side queue that forwards produced payloads to the central queue.
import { Context, Effect } from 'effect';

export class TriggerQueue extends Context.Tag('system/TriggerQueue')<
  TriggerQueue,
  { readonly offer: (payload: unknown) => Effect.Effect<void> }
>() { }
