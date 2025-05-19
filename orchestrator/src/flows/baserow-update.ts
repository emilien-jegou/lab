import { z } from 'zod';
import { flow } from '../core/flow';
import { script } from '../core/script';
import { webhookTrigger } from '../triggers/webhook';

const wt = webhookTrigger('/hooks/baserow-update')
  .schema(z.object({ b: z.number() }))
  .build();

export default flow('baserow-update')(
  script('first', async (a: { b: number }): Promise<string> => {
    return '123';
  }),
  script('second', async (b: string): Promise<string> => {
    return b;
  }),
).trigger(wt);
