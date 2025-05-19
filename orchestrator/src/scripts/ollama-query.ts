import type { GenerateResponse } from 'ollama';
import { Ollama } from 'ollama';

const ollama = new Ollama({
  host: 'http://ollama:11434',
});

export const llmgenerate = async (prompt: string, format: string): Promise<any> => {
  const res: GenerateResponse = await ollama.generate({
    model: 'gemma3:4b',
    prompt: `Your JSON response NEED to follow this typescript type '${format}'. ${prompt}`,
    format: 'json',
    stream: false,
    options: {},
  });

  return JSON.parse(res.response);
};
