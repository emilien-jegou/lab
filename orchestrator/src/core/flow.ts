import type { FlowLogger } from '~/utils/logger';
import { flowPipe } from './flow-pipe';
import type { Script } from './script';
import type { Trigger } from './trigger';

export interface Flow<In, Out> {
  kind: 'flow';
  name: string;
  _triggers: Trigger<In>[];
  trigger(t: Trigger<In>): this;
  scripts: Script[];
  run: (v: In, logger: FlowLogger) => Out;
}

export const flow = (name: string): typeof flowPipe => {
  return flowPipe.bind({ name });
};
