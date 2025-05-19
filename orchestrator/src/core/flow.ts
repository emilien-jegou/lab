import { flowPipe } from './flow-pipe';
import type { Trigger } from './trigger';

export interface Flow<In, Out> {
  kind: 'flow';
  name: string;
  _triggers: Trigger<In>[];
  trigger(t: Trigger<In>): this;
  run: (v: In) => Out;
}

export const flow = (name: string): typeof flowPipe => {
  return flowPipe.bind({ name });
};
