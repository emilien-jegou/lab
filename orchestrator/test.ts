// Helper type to remove trailing characters
type RemoveTrailing<S extends string, C extends string> = S extends `${infer Prefix}${C}`
  ? RemoveTrailing<Prefix, C>
  : S;

// Much simpler approach - treat array indices as object keys
export type GetKeysDeep<T> = T extends object
  ? RemoveTrailing<
      {
        [K in keyof T]-?: K extends string
          ? // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            T[K] extends Function
            ? K
            : T[K] extends object
              ? `${K}.${GetKeysDeep<T[K]>}` | K
              : K
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

// Example usage:
type TestObj = {
  user: {
    profile: {
      name: string;
      age: number;
    };
    settings: {
      theme: string;
    };
  };
  posts: Array<{
    title: string;
    content: string;
    tags: string[];
  }>;
  numbers: [1, 2, 3, 4, 5]; // tuple
  dynamicNumbers: number[]; // regular array
  getName: () => string;
};

// Now array indices work naturally as object keys!
type Keys = GetKeysDeep<TestObj>;
// Includes: "user", "posts", "numbers", "getName", "posts.0", "posts.0.title",
// "posts.0.tags", "posts.0.tags.0", "numbers.0", "numbers.1", etc.

// Test cases
type UserName = GetValueDeep<TestObj, 'user.profile.name'>; // string
type FirstPost = GetValueDeep<TestObj, 'posts.0'>; // { title: string; content: string; tags: string[]; }
type FirstPostTitle = GetValueDeep<TestObj, 'posts.0.title'>; // string
type FirstNumber = GetValueDeep<TestObj, 'numbers.0'>; // 1 (literal for tuples)
type SecondNumber = GetValueDeep<TestObj, 'numbers.1'>; // 2 (literal for tuples)

// The beauty is that this works for any numeric key that exists on the array/tuple
type TestCases = {
  directUser: GetValueDeep<TestObj, 'user'>;
  nestedName: GetValueDeep<TestObj, 'user.profile.name'>;
  firstPost: GetValueDeep<TestObj, 'posts.0'>;
  firstPostTitle: GetValueDeep<TestObj, 'posts.0.title'>;
  firstPostFirstTag: GetValueDeep<TestObj, 'posts.0.tags.0'>;
  exactFirst: GetValueDeep<TestObj, 'numbers.0'>; // 1
  exactSecond: GetValueDeep<TestObj, 'numbers.1'>; // 2
  functionAccess: GetValueDeep<TestObj, 'getName'>;
};
