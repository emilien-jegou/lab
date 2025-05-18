type Prev = [never, 0, 1, 2, 3];

export type DeepKeys<T, D extends number = 3> = [D] extends [never] ? never :
  T extends Date ? never :
  T extends readonly unknown[] ? never :
  T extends object ? {
    [K in keyof T]-?: K extends string | number
    ? T[K] extends Date | readonly unknown[] ? `${K}`
    : T[K] extends object ? `${K}` | `${K}.${DeepKeys<T[K], Prev[D]>}` : `${K}`
    : never
  }[keyof T] : never;

export type DeepValue<T, P> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T ? DeepValue<T[K], Rest> : never
  : P extends keyof T ? T[P] : never;

export type DeepPartial<T> = T extends Function ? T :
  T extends Array<infer U> ? _DeepPartialArray<U> :
  T extends object ? _DeepPartialObject<T> : T | undefined;
interface _DeepPartialArray<T> extends Array<DeepPartial<T>> { }
type _DeepPartialObject<T> = { [P in keyof T]?: DeepPartial<T[P]> };

export type Unpacked<T> = T extends (infer U)[] ? U : T;
