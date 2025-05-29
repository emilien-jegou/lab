import { RedisClient } from 'bun';
import { serve } from '../utils/server';
import { loadFlows } from './flow-loader';
import './worker';

export const launch = async () => {
  const flows = await loadFlows();

  for (const flow of flows) {
    for (const trigger of flow.triggers) {
      trigger.register(flow, new RedisClient());
    }
  }

  await serve();
};
