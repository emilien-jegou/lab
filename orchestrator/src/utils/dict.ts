export type Dict = Record<string, unknown>;

// Set a key-value pair in a dictionary type
export type DictSet<Obj extends Dict, Key extends keyof Dict, V> = Omit<Obj, Key> & Record<Key, V>;

// Get the value type of a key from a dictionary type
export type DictGet<Obj extends Dict, Key extends keyof Dict> = Obj[Key];

// Remove a key from a dictionary type
export type DictRemove<Obj extends Dict, Key extends keyof Dict> = Omit<Obj, Key>;

// Check if a key exists in a dictionary type (returns true or false)
export type DictHas<Obj extends Dict, Key extends keyof Dict> = Key extends keyof Obj
  ? true
  : false;

// Set a key-value pair in a dictionary type
export type DictMerge<Obj extends Dict, Other extends Dict> = Omit<Obj, keyof Other> & Other;

