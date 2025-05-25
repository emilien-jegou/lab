import type { Dict } from '~/utils/dict';
import { sleep } from '~/utils/sleep';
import { script } from '../core/script';

export const printContext = script<any, Dict, any>('printing context', async (ctx) => {
  console.debug('context', ctx);
  await sleep(4000);
  console.log('Finishing.');
  return { ...ctx.prev, printed: true };
});
