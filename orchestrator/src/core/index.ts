import { createOrchestratorLogger } from '../utils/logger';
import { serve } from '../utils/server';
import { loadFlows } from './flow-loader';

export const launch = async () => {
  const flows = await loadFlows();
  const logger = createOrchestratorLogger();

  for (const flow of flows) {
    for (const trigger of flow._triggers) {
      trigger.register(flow, logger);
    }
  }

  await serve();
};
