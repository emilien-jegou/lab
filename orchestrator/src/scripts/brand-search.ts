import { z } from 'zod';
import { searchSearxng } from '~/helpers/query-searxng';
import { script } from '../core/script';

export const item = z.object({
  id: z.number(),
  name: z.string(),
  order: z.number(),
  table_id: z.string(),
});

type Item = z.infer<typeof item>;

type Search = {
  url: string;
  title: string;
  description: string;
  score: number;
};

export const brandSearch = script<Item, { searches: Search[]; item: Item }>(
  'web search for brand url',
  async ({ prev, cancel }) => {
    if (prev.name.trim().length < 3) throw new Error('too short');
    const searchResult = (await searchSearxng(`${prev.name}, clothing !sp`)).results;

    if (searchResult.length <= 4) {
      console.log(`while searching: ${prev.name}`);
      cancel();
      return {} as any;
    }

    const searches = searchResult.map((item) => {
      return {
        url: new URL(item.url).host,
        title: item.title,
        description: item.content,
        score: item.score,
      };
    });

    return { searches, item };
  },
);
