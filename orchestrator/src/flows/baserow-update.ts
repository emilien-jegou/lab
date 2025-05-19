import { z } from 'zod';
import { llmgenerate } from '~/scripts/ollama-query';
import type { SearxngResult } from '~/scripts/query-searxng';
import { searchSearxng } from '~/scripts/query-searxng';
import { saveToBaserow } from '~/scripts/save-to-baserow';
import { flow } from '../core/flow';
import type { ScriptContext } from '../core/script';
import { script } from '../core/script';
import { webhookTrigger } from '../triggers/webhook';

const item = z.object({
  id: z.number(),
  name: z.string(),
  order: z.number(),
  table_id: z.string(),
});

const wt = webhookTrigger('/hooks/baserow-update').schema(item).build();

type Item = z.infer<typeof item>;

const getBrandShoppingPlace = script(
  'web for brand url',
  async (item: Item, ctx): Promise<{ item: Item; searchResult: SearxngResult[] }> => {
    if (item.name.trim().length < 3) throw new Error('too short');
    const queryResult = await searchSearxng(`${item.name}, clothing !sp`);

    const searchResult = queryResult.results;

    if (searchResult.length <= 4) {
      ctx.logger.log(`while searching: ${item.name}`);
      ctx.cancel();
      return {} as any;
    }

    return { item, searchResult };
  },
);

type ItemWithUrl = z.infer<typeof item> & { url: string };

const inquireUrlValid = script(
  'llm guessing for best fit url',
  async (input: { item: Item; searchResult: SearxngResult[] }, ctx): Promise<ItemWithUrl> => {
    const searches = input.searchResult.map((item) => {
      return {
        url: new URL(item.url).host,
        title: item.title,
        description: item.content,
        score: item.score,
      };
    });

    const query = `Out of thoses url which is the best fit for the website of the clothin fashion brand ${input.item.name}? Be warn ${input.item.name} is selling clothing it's not a platform featuring other brands. IF YOU CANT FIND THE URL SEND AN ERROR AS PER SCHEMA. Array of urls ${JSON.stringify(searches)}`;
    const res = await llmgenerate(query, '{ url: string } or { error: string }');
    const elem = searches.find((s) => s.url === res.url);
    ctx.logger.info(`LLM best fit url: ${JSON.stringify(res)}`);

    if (elem === undefined) {
      ctx.logger.error(`Got ${res.url}, urls array: ${JSON.stringify(searches.map((i) => i.url))}`);
      throw new Error("Couldn't find best fit url in search results");
    }

    const isClothingWebsite = await llmgenerate(
      `Does this url seems like the url for the clothing website of '${input.item.name}' to you? ${JSON.stringify(elem)}`,
      '{ answer: boolean }',
    );

    if (isClothingWebsite.answer === false) {
      throw new Error("Couldn't find suitable url in search results");
    }
    return { ...input.item, url: '' };
  },
);

const updateBrandOnBaserow = script(
  'update brand url on baserow',
  async (item: ItemWithUrl, _ctx: ScriptContext): Promise<void> => {
    await saveToBaserow(item.table_id, item.id, {
      URL: item.url,
    });
  },
);

export default flow('baserow-update')(
  getBrandShoppingPlace,
  inquireUrlValid,
  updateBrandOnBaserow,
).trigger(wt);
