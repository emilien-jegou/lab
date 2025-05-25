export type SearxngResult = {
  url: string;
  title: string;
  content: string;
  thumbnail: string;
  engine: string;
  template: string;
  parsed_url: [string, string, string, string, string, string];
  img_src: string;
  priority: string;
  engines: string[];
  positions: number[];
  score: number;
  category: string;
  publishedDate: string | null;
};

export type SearxngSearchResponse = {
  query: string;
  number_of_results: number;
  results: SearxngResult[];
  answers: any[];
  corrections: any[];
  infoboxes: any[];
  suggestions: string[];
  unresponsive_engines: string[];
};

export async function searchSearxng(
  query: string,
  instanceUrl: string = 'http://searxng:8080',
): Promise<SearxngSearchResponse> {
  const url = new URL('/search', instanceUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`SearXNG request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return data as SearxngSearchResponse;
}
