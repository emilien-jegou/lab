import { z } from 'zod';
import { updateBrandOnBaserow } from '~/scripts/baserow-update';
import { bestFitBrandUrl } from '~/scripts/best-fit-brand-url';
import { brandSearch } from '~/scripts/brand-search';
import { flow } from '../core/flow';
import { webhookTrigger } from '../triggers/webhook';

const wt = webhookTrigger('/hooks/baserow-update')
  .schema(
    z.object({
      id: z.number(),
      name: z.string(),
      order: z.number(),
      table_id: z.string(),
    }),
  )
  .build();

// prettier-ignore
export default flow('baserow_update')
  .trigger(wt)
  //.for((i) => i.retryCount, (f) =>
  .$(brandSearch.store('search')).$(bestFitBrandUrl).$(updateBrandOnBaserow);
//)
