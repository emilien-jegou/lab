import { compile } from 'json-schema-to-typescript';
import type { GenerateResponse } from 'ollama';
import { Ollama } from 'ollama';
import type { ZodSchema } from 'zod';
import z from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

const ollama = new Ollama({
  host: 'http://ollama:11434',
});

export const llmgenerate = async (prompt: string, format: string): Promise<any> => {
  const res: GenerateResponse = await ollama.generate({
    model: 'gemma3:4b',
    prompt: `Your JSON response NEED to follow the following json schema '${format}'. ${prompt}`,
    format: 'json',
    stream: false,
    options: {},
  });

  return JSON.parse(res.response);
};

const regex = new RegExp(`export\\s+interface\\s+Response\\s*\\{`);

// only works for object types
const getTypeInferenceString = async <S extends ZodSchema>(schema: S) => {
  const jsonSchema = zodToJsonSchema(schema);
  const res = await compile(jsonSchema as any, 'Response', {
    bannerComment: '',
    format: false,
    ignoreMinAndMaxItems: true,
  });

  const startMatch = res.match(regex);

  if (!startMatch) throw new Error("couldn't find schema");

  const startIndex = res.indexOf(startMatch[0]) + startMatch[0].length;
  let braceCount = 1;
  let i = startIndex;

  while (i < res.length && braceCount > 0) {
    if (res[i] === '{') braceCount++;
    else if (res[i] === '}') braceCount--;
    i++;
  }

  if (braceCount !== 0) throw new Error("couldn't find schema end");

  return (
    '{ ' +
    res
      .slice(startIndex, i - 1)
      .split('\n')
      .join(' ')
      .trim() +
    ' }'
  );
};

const stringifyTemplateWithChecks = (strings: TemplateStringsArray, values: any[], ctx: any) => {
  const buffer: string[] = [];

  for (let i = 0; i < strings.length; i++) {
    buffer.push(strings[i]);

    if (i < values.length) {
      const value = values[i];

      if (value === null || value === undefined) {
        throw new Error(
          `Nullish (${String(value)}) interpolation value in template at index ${i} is not allowed.`,
        );
      }

      if (typeof value === 'object') {
        buffer.push(JSON.stringify(value));
      } else if (typeof value === 'function') {
        buffer.push(value(ctx));
      } else {
        buffer.push(String(value));
      }
    }
  }

  return buffer.join('').split('\n').filter(Boolean).join('\n');
};

export const aiPreparedQuery =
  <S extends ZodSchema>(schema: S) =>
  <I = any>() => {
    // string representation of the schema as a typescript type (compact)
    const inferenceString = getTypeInferenceString(schema);

    return function (
      strings: TemplateStringsArray,
      ...values: (((context: I) => any) | string | number | object)[]
    ) {
      return async (ctx: I): Promise<z.infer<S>> => {
        const input = stringifyTemplateWithChecks(strings, values, ctx);
        const res = await inferenceString;
        console.log(`Running query: ${input}`);
        const generated = await llmgenerate(input, res);

        const result = schema.safeParse(generated);

        if (!result.success) {
          throw new Error(
            `generated string doesn't respect schema, expected ${inferenceString} got errors: ${result.error}`,
          );
        }

        return result.data;
      };
    };
  };

export const aiYesNo = aiPreparedQuery(z.object({ answer: z.boolean() }));
