import { RedisClient } from 'bun';
import { useEffect, useState } from 'react';
import type { FlowEntity } from '~/utils/tracer';
import { getFlowStorage } from '~/utils/tracer';

export const useFlows = (): Record<string, FlowEntity> => {
  const [flows, setFlows] = useState<Record<string, FlowEntity>>({});

  useEffect(() => {
    let p: any;
    (async () => {
      const client = new RedisClient();
      const flowStorage = getFlowStorage(client);

      const elems = await flowStorage.getAll();
      setFlows(Object.fromEntries(elems.map((e) => [e.id, e])));

      p = await flowStorage.subscribe(async (id) => {
        const newEntity = await flowStorage.getById(id);
        if (!newEntity) return console.error('flow not found, id:', id);
        setFlows((v) => ({ ...v, [id]: newEntity }));
      });
    })();
    return () => {
      if (p) p();
    };
  }, []);

  return flows;
};
