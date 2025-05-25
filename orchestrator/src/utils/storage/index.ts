import { type RedisClientType } from 'redis';
import { createClient } from 'redis';
import { setIndexedValue, type GetKeysDeep, type GetValueDeep } from '../indexed';
import type { Opaque } from '../opaque';

export type StorageClient = Opaque<RedisClientType, 'StorageClient'>;

// Option 1: Simple approach with REDIS_URL or defaults
export const createStorageClient = async (): Promise<StorageClient> => {
  const client: RedisClientType = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  await client.connect();
  return client as StorageClient;
};

type Entity = { id: string };

type Operation<T extends Entity> =
  | { kind: 'set'; entity: T }
  | { kind: 'update'; entity: T }
  | { kind: 'remove'; id: string };

// Storage abstraction interface
export type Storage<T extends Entity> = {
  subscribe(onMessage: (op: Operation<T>) => void): Promise<() => void>;
  set(entity: T): Promise<void>;
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | undefined>;
  getByName(name: string): Promise<T[]>;
  update(entity: T): Promise<boolean>;
  merge(id: string, partial: Omit<Partial<T>, 'id'>): Promise<boolean>;
  mergeDeep<K extends GetKeysDeep<T>>(
    id: string,
    key: K,
    value: GetValueDeep<T, K>,
  ): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  count(): Promise<number>;
};

export const PREFIX_SEPARATOR = ':';
export const createRedisStorage = <T extends Entity>(
  client: StorageClient,
  prefixes: string[],
): Storage<T> => {
  const keyPrefix = prefixes.join(PREFIX_SEPARATOR);
  const createKey = (id: string) => `${keyPrefix}${PREFIX_SEPARATOR}${id}`;
  const getAllKeysPattern = `${keyPrefix}${PREFIX_SEPARATOR}*`;
  const keyMatchPattern = new RegExp(`${keyPrefix}${PREFIX_SEPARATOR}([^${PREFIX_SEPARATOR}]+)$`);
  const pubsubChannel = `${keyPrefix}:events`;

  // Helper function to publish messages
  const publishMessage = async (operation: Operation<T>) => {
    try {
      const message = JSON.stringify(operation);
      await client.publish(pubsubChannel, message);
    } catch (error) {
      console.error('Failed to publish pubsub message:', error);
    }
  };

  return {
    subscribe: async (onMessage: (op: Operation<T>) => void) => {
      // Create a separate Redis client for subscription (redis requirement)
      const subscriber = client.duplicate();
      await subscriber.connect();
      // Subscribe to the pubsub channel
      await subscriber.subscribe(pubsubChannel, (message) => {
        try {
          const parsed = JSON.parse(message);
          onMessage(parsed);
        } catch (error) {
          console.error('Failed to parse pubsub message:', error);
        }
      });
      // Return unsubscribe function
      return async () => {
        try {
          await subscriber.unsubscribe(pubsubChannel);
          await subscriber.disconnect();
        } catch (error) {
          console.error('Failed to unsubscribe:', error);
        }
      };
    },
    async set(entity: T): Promise<void> {
      const key = createKey(entity.id);
      await client.set(key, JSON.stringify(entity));
      await publishMessage({ kind: 'set', entity });
    },
    async getAll(): Promise<T[]> {
      const keys = await client.keys(getAllKeysPattern);
      const filteredKeys = keys.filter((k) => keyMatchPattern.test(k));
      if (filteredKeys.length === 0) return [];
      const values = await client.mGet(filteredKeys);
      return values
        .filter((value): value is string => value !== null)
        .map((value) => JSON.parse(value) as T);
    },
    async getById(id: string): Promise<T | undefined> {
      const key = createKey(id);
      const value = await client.get(key);
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
      const exists = await client.exists(key);
      if (!exists) return false;
      await client.set(key, JSON.stringify(entity));
      await publishMessage({ kind: 'update', entity });
      return true;
    },

    async mergeDeep<K extends GetKeysDeep<T>>(
      id: string,
      key: K,
      value: GetValueDeep<T, K>,
    ): Promise<boolean> {
      const redisKey = createKey(id);
      const existingValue = await client.get(redisKey);
      if (!existingValue) return false;
      const entity = JSON.parse(existingValue) as T;
      setIndexedValue(entity, key, value);
      await client.set(redisKey, JSON.stringify(entity));
      await publishMessage({ kind: 'update', entity });
      return true;
    },

    async merge(id: string, partial: Omit<Partial<T>, 'id'>): Promise<boolean> {
      const key = createKey(id);
      const existingValue = await client.get(key);
      if (!existingValue) return false;
      const existingEntity = JSON.parse(existingValue) as T;
      const mergedEntity = { ...existingEntity, ...partial };
      await client.set(key, JSON.stringify(mergedEntity));
      await publishMessage({ kind: 'update', entity: mergedEntity });
      return true;
    },

    async remove(id: string): Promise<boolean> {
      const key = createKey(id);
      const deleted = await client.del(key);
      if (deleted > 0) {
        await publishMessage({ kind: 'remove', id });
      }
      return deleted > 0;
    },
    async count(): Promise<number> {
      const keys = await client.keys(getAllKeysPattern);
      return keys.length;
    },
  };
};
