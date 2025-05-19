import { readdirSync } from 'fs';
import { join, extname } from 'path';
import type { Flow } from './flow';

// Note: On Windows, pathname starts with a leading slash; may need to strip it
const directory = join(process.cwd(), './src/flows');

export const loadFlows = async (): Promise<Flow<unknown, unknown>[]> => {
  // Read all .ts files and dynamically import them
  const modules = readdirSync(directory)
    .filter((f) => extname(f) === '.ts')
    .map(async (file) => {
      const module = await import(join(directory, file));
      return { file, module };
    });

  const all = await Promise.all(modules);

  return all
    .filter(({ file, module }) => {
      if (!module.default) {
        console.error(`${file}: flow file doesn't have a default export`);
        return false;
      } else if (module.default.kind !== 'flow') {
        console.error(`${file}: default export is not a flow`);
        return false;
      }
      return true;
    })
    .map(({ module }) => module.default);
};
