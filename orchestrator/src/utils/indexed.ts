import type { Option } from './option';
import { none, some } from './option';

type RemoveTrailing<S extends string, C extends string> = S extends `${infer Prefix}${C}`
  ? RemoveTrailing<Prefix, C>
  : S;

export type GetKeysDeep<T> = T extends object
  ? RemoveTrailing<
      {
        [K in keyof T]-?: K extends string
          ? // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            T[K] extends Function
            ? K
            : `${K & string}.${GetKeysDeep<T[K]>}` | K
          : never;
      }[keyof T],
      '.'
    >
  : '';

export type GetValueDeep<T, K extends GetKeysDeep<T>> = K extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? Rest extends GetKeysDeep<T[Key]>
      ? GetValueDeep<T[Key], Rest>
      : never
    : never
  : T extends undefined
    ? never
    : K extends keyof T
      ? T[K]
      : never;

export const getIndexedValue = <T, K extends GetKeysDeep<T>>(
  obj: T,
  needle: K,
): Option<GetValueDeep<T, K>> => {
  const keys = needle.split('.');
  let result: any = obj;
  for (const k of keys) {
    if (result && typeof result === 'object' && k in result) {
      result = result[k];
    } else {
      return none();
    }
  }
  return some(result as GetValueDeep<T, K>);
};

export const setIndexedValue = <T, K extends GetKeysDeep<T>>(
  obj: T,
  needle: K,
  value: GetValueDeep<T, K>,
) => {
  const keys = needle.split('.');
  let currentObj: any = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof currentObj[k] !== 'object' || !currentObj[k]) {
      currentObj[k] = {};
    }
    currentObj = currentObj[k];
  }

  currentObj[keys[keys.length - 1]] = value;
};

export const removeIndexedValue = <T, K extends GetKeysDeep<T>>(obj: T, needle: K) => {
  const keys = needle.split('.');
  let currentObj: any = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof currentObj[k] !== 'object' || !currentObj[k]) {
      currentObj[k] = {};
    }
    currentObj = currentObj[k];
  }

  delete currentObj[keys[keys.length - 1]];
};
