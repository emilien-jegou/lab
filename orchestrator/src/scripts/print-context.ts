import type { Dict } from '~/utils/dict';
import { script } from '../core/script';

export const printContext = script<any, Dict, any>('printing context', async (ctx) => {
  console.debug(ctx);
  return { ...ctx.prev, printed: true };
});
