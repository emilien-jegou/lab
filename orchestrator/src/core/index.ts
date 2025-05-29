import { createAppTracer } from '~/utils/tracer';
import { serve } from '../utils/server';
import { loadFlows } from './flow-loader';
import './worker';

export const launch = async () => {
  const flows = await loadFlows();
  const tracer = createAppTracer();

  for (const flow of flows) {
    for (const trigger of flow.triggers) {
      trigger.register(flow, tracer);
    }
  }

  await serve();
};
