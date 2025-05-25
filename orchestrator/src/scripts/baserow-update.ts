import { script } from '~/core/script';
import { saveToBaserow } from '~/helpers/save-to-baserow';
import type { ItemWithUrl } from './best-fit-brand-url';

export const updateBrandOnBaserow = script<
  ItemWithUrl,
  Record<never, never>,
  { store: { search: any } }
>('update brand url on baserow', async ({ prev }) => {
  await saveToBaserow(prev.table_id, prev.id, {
    URL: prev.url,
  });
  return {};
});
