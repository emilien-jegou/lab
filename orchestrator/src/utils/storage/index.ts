import { sleep, type RedisClient } from 'bun';

type Entity = {
  id: string;
};

// Storage abstraction interface
export type Storage<T extends Entity> = {
  subscribe(cb: (key: string, intervalMs?: number) => void): Promise<() => void>;
  set(entity: T): Promise<void>;
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | undefined>;
  getByName(name: string): Promise<T[]>;
  update(entity: T): Promise<boolean>;
  merge(id: string, partial: Omit<Partial<T>, 'id'>): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
  count(): Promise<number>;
};

export const PREFIX_SEPARATOR = ':';

export const createRedisStorage = <T extends Entity>(
  redis: RedisClient,
  prefixes: string[],
): Storage<T> => {
  const keyPrefix = prefixes.join(PREFIX_SEPARATOR);
  const createKey = (id: string) => `${keyPrefix}${PREFIX_SEPARATOR}${id}`;
  const getAllKeysPattern = `${keyPrefix}${PREFIX_SEPARATOR}*`;
  const keyMatchPattern = new RegExp(`${keyPrefix}${PREFIX_SEPARATOR}([^${PREFIX_SEPARATOR}]+)$`);

  return {
    subscribe: async (onNewKey: (key: string) => void, intervalMs: number = 1000) => {
      let isPolling = true;

      const knownKeys: Set<string> = new Set();

      // Get initial set of keys
      const existingKeys = await redis.keys(`${keyPrefix}${PREFIX_SEPARATOR}*`);
      if (Array.isArray(existingKeys)) {
        existingKeys.forEach((key) => {
          if (typeof key === 'string' && keyMatchPattern.test(key)) {
            knownKeys.add(key);
          }
        });
      }

      (async () => {
        while (isPolling) {
          try {
            // Get current keys matching our pattern
            const currentKeys = await redis.keys(`${keyPrefix}${PREFIX_SEPARATOR}*`);

            if (Array.isArray(currentKeys)) {
              for (const key of currentKeys) {
                const match = keyMatchPattern.exec(key);
                if (typeof key === 'string' && match) {
                  // Check if is a new key
                  if (!knownKeys.has(match[0])) {
                    knownKeys.add(match[0]);
                    onNewKey(match[1]);
                  }
                }
              }
            }

            // Wait before next poll
            await sleep(intervalMs);
          } catch (error) {
            console.error('Error during polling:', error);
            await sleep(intervalMs);
          }
        }
      })();

      return () => {
        isPolling = false;
      };
    },
    async set(entity: T): Promise<void> {
      const key = createKey(entity.id);
      await redis.set(key, JSON.stringify(entity));
    },

    async getAll(): Promise<T[]> {
      const keys = await redis.keys(getAllKeysPattern);
      const filteredKeys = keys.filter((k) => keyMatchPattern.test(k));
      if (filteredKeys.length === 0) return [];

      const values = await redis.mget(...filteredKeys);
      return values
        .filter((value): value is string => value !== null)
        .map((value) => JSON.parse(value) as T);
    },

    async getById(id: string): Promise<T | undefined> {
      const key = createKey(id);
      const value = await redis.get(key);
      return value ? (JSON.parse(value) as T) : undefined;
    },

    async getByName(name: string): Promise<T[]> {
      const allEntities = await this.getAll();
      return allEntities.filter(
        (entity) => 'name' in entity && typeof entity.name === 'string' && entity.name === name,
      );
    },

    async update(entity: T): Promise<boolean> {
      const key = createKey(entity.id);
      const exists = await redis.exists(key);
      if (!exists) return false;

      await redis.set(key, JSON.stringify(entity));
      return true;
    },

    async merge(id: string, partial: Omit<Partial<T>, 'id'>): Promise<boolean> {
      const key = createKey(id);
      const existingValue = await redis.get(key);

      if (!existingValue) return false;

      const existingEntity = JSON.parse(existingValue) as T;
      const mergedEntity = { ...existingEntity, ...partial };

      await redis.set(key, JSON.stringify(mergedEntity));
      return true;
    },

    async remove(id: string): Promise<boolean> {
      const key = createKey(id);
      const deleted = await redis.del(key);
      return deleted > 0;
    },

    async clear(): Promise<void> {
      const keys = await redis.keys(getAllKeysPattern);
      if (keys.length === 0) return;
      await Promise.all(keys.map((key) => redis.del(key)));
    },

    async count(): Promise<number> {
      const keys = await redis.keys(getAllKeysPattern);
      return keys.length;
    },
  };
};
