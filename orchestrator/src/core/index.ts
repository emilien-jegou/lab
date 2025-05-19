import { FlowLogger } from '../utils/logger';
import { serve } from '../utils/server';
import { loadFlows } from './flow-loader';

export const launch = async () => {
  const logger = new FlowLogger();
  const flows = await loadFlows();

  for (const flow of flows) {
    for (const trigger of flow._triggers) {
      trigger.register(flow, logger);
    }
  }

  await serve();
};
