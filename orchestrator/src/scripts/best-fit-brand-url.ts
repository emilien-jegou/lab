import z from 'zod';
import { script } from '~/core/script';
import { aiPreparedQuery, aiYesNo } from '~/helpers/ollama-query';

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

const bestFitQuery = aiPreparedQuery(z.object({ url: z.string() }))<{
  itemName: string;
  searches: Search[];
}>()`
Out of thoses url which is the best fit for the website of
the clothing fashion brand ${(c) => c.itemName}:
${(c) => JSON.stringify(c.searches)}
`;

const inquireIsClothingWebsite = aiYesNo<{
  itemName: string;
  elem: Search;
}>()`
Does this url seems like the url for the clothing website of '${(c) => c.itemName}' to you? ${(c) => JSON.stringify(c.elem)}
`;

type ItemWithUrl = z.infer<typeof item> & { url: string };

export const bestFitBrandUrl = script<{ item: Item; searches: Search[] }, ItemWithUrl>(
  'llm guessing for best fit brand url',
  async ({ prev }) => {
    const res = await bestFitQuery({ itemName: prev.item.name, searches: prev.searches });
    const elem = prev.searches.find((s) => s.url === res.url);
    console.debug(`LLM best fit url: ${JSON.stringify(res)}`);

    if (elem === undefined) {
      console.error(
        `Got ${res.url}, urls array: ${JSON.stringify(prev.searches.map((i) => i.url))}`,
      );
      throw new Error("Couldn't find best fit url in search results");
    }

    const isClothingWebsite = await inquireIsClothingWebsite({ itemName: prev.item.name, elem });

    if (isClothingWebsite.answer === false) {
      throw new Error("Couldn't find suitable url in search results");
    }

    return { ...prev.item, url: '' };
  },
);
