import { searchSearxng } from '~/helpers/query-searxng';
import { script } from '../core/script';

type Item = {
  id: number;
  name: string;
  order: number;
  table_id: string;
};

type Search = {
  url: string;
  title: string;
  description: string;
  score: number;
};

export const brandSearch = script<any, { searches: Search[] }, { iter: Item }>(
  'web search for brand url',
  async ({ iter }, methods) => {
    if (iter.name.trim().length < 3) throw new Error('too short');
    const searchResult = (await searchSearxng(`${iter.name}, clothing !sp`)).results;

    if (searchResult.length <= 4) {
      console.log(`while searching: ${iter.name}`);
      methods.cancel();
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

    return { searches };
  },
);
