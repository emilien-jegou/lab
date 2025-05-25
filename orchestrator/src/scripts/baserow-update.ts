import z from 'zod';
import { script } from '~/core/script';
import { saveToBaserow } from '~/helpers/save-to-baserow';

export const item = z.object({
  id: z.number(),
  name: z.string(),
  order: z.number(),
  table_id: z.string(),
});

type ItemWithUrl = z.infer<typeof item> & { url: string };

export const updateBrandOnBaserow = script<ItemWithUrl, void, { search: any }>(
  'update brand url on baserow',
  async ({ prev }) => {
    await saveToBaserow(prev.table_id, prev.id, {
      URL: prev.url,
    });
  },
);
