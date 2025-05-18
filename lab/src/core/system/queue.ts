// Central job queue service with per-group routing.
import { Context, Effect, Layer, Queue, Ref } from 'effect';

import type { Job } from './job';

export class CentralQueue extends Context.Tag('system/CentralQueue')<
  CentralQueue,
  {
    readonly offer: (job: Job) => Effect.Effect<void>;
    readonly take: (groups: string[]) => Effect.Effect<Job>;
  }
>() { }

export const CentralQueueLive: Layer.Layer<CentralQueue> = Layer.effect(
  CentralQueue,
  Effect.gen(function*() {
    const queues = yield* Ref.make(new Map<string, Queue.Queue<Job>>());

    const getOrCreateQueue = (group: string) =>
      Effect.gen(function*() {
        const q = yield* Queue.unbounded<Job>();
        return yield* Ref.modify(queues, (map) => {
          if (map.has(group)) return [map.get(group)!, map] as const;
          return [q, new Map(map).set(group, q)] as const;
        });
      });

    return CentralQueue.of({
      offer: (job) =>
        Effect.gen(function*() {
          const group = job.targetGroup || 'default';
          const q = yield* getOrCreateQueue(group);
          yield* Queue.offer(q, job);
        }),
      take: (groups) =>
        Effect.gen(function*() {
          const safeGroups = groups.length > 0 ? groups : ['default'];
          const qs = yield* Effect.forEach(safeGroups, getOrCreateQueue);
          const first = qs[0];

          if (!first) {
            const fallback = yield* getOrCreateQueue('default');
            return yield* Queue.take(fallback);
          }

          if (qs.length === 1) {
            return yield* Queue.take(first);
          }

          return yield* Effect.raceAll(qs.map((q) => Queue.take(q)));
        }),
    });
  }),
);
