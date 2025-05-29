import { z } from 'zod';
//import { updateBrandOnBaserow } from '~/scripts/baserow-update';
//import { bestFitBrandUrl } from '~/scripts/best-fit-brand-url';
//import { brandSearch } from '~/scripts/brand-search';
import { printContext } from '~/scripts/print-context';
import { flow } from '../core/flow';
import { webhookTrigger } from '../triggers/webhook';
//import { printContext } from '~/scripts/print-context';

// Schema for the whole webhook payload
export const BaserowWebhookSchema = z.object({
  table_id: z.number(),
  database_id: z.number(),
  workspace_id: z.number(),
  event_id: z.string(),
  event_type: z.string(), // Could be narrowed to enum if desired
  items: z.array(
    z
      .object({
        id: z.number(),
        name: z.string(),
        order: z.number(),
        table_id: z.string(),
      })
      .catchall(z.unknown()),
  ),
});

const wt = webhookTrigger('/hooks/baserow-update').schema(z.any()).build();

// prettier-ignore

export default flow('baserow_update')
  .trigger(wt)
  .$(printContext)
//.for((_) => Array.from({ length: 10 }, (_, idx) => idx), (iter) =>
//  iter.$(printContext)
//    .$(printContext)
//)

//export default flow('baserow_update')
//  .trigger(wt)
//  .for((i) => i.prev.items, (iter) => {
//    return iter.$(brandSearch.store('search'))
//      .$(bestFitBrandUrl)
//      .$(updateBrandOnBaserow)
//  })
