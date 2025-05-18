// Worker pool: forks workers that consume jobs from the central queue.
import { Effect, Layer } from 'effect';

import { CentralQueue } from './queue';
import { processJob } from './job-processor';
import type { Job } from './job';
import type { IWorkerConfig } from './worker-config';

export interface WorkerProvisionConfig {
  readonly provide: number;
  readonly groups: string[];
}

export const WorkerPoolLive = (
  configs: WorkerProvisionConfig[] = [
    { provide: 5, groups: ['default', 'internal', 'system'] },
    { provide: 2, groups: ['webhooks', 'high-priority'] },
  ],
): Layer.Layer<never, never, CentralQueue> =>
  Layer.scopedDiscard(
    Effect.gen(function*() {
      const queue = yield* CentralQueue;

      let totalWorkers = 0;
      let workerIndex = 1;

      for (const config of configs) {
        for (let i = 0; i < config.provide; i++) {
          totalWorkers++;
          const workerId = `worker-${workerIndex++}`;
          const subscribedGroups = [...config.groups];

          const workerLoop = Effect.gen(function*() {
            const job: Job = yield* queue.take(subscribedGroups);
            const workerCtx: IWorkerConfig = {
              workerId,
              subscribedGroups,
              currentTaskGroup: job.targetGroup || 'default',
            };
            yield* processJob(job, workerCtx);
          }).pipe(
            Effect.forever,
            Effect.annotateLogs({ workerId, groups: subscribedGroups.join(',') }),
          );

          yield* Effect.forkScoped(workerLoop);
        }
      }

      console.log(`[WorkerPoolLive] Successfully started ${totalWorkers} workers.`);
    }),
  );
