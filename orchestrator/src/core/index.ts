import { createStorageClient } from '~/utils/storage';
import { serve } from '../utils/server';
import { loadFlows } from './flow-loader';
import './worker';

export const launch = async () => {
  const flows = await loadFlows();
  const client = await createStorageClient();
  for (const flow of flows) {
    for (const trigger of flow.triggers) {
      trigger.register(flow, client);
    }
  }

  await serve();
};
