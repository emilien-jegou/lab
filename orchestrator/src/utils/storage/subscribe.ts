import { RedisClient } from 'bun';
import { sleep } from '../sleep';
import { PREFIX_SEPARATOR } from '.';

// const pattern = /^name:[^:]+$/;
export const createRedisKeyDetector = async (client: RedisClient, keyPrefix: string) => {
  const pattern = new RegExp(`${keyPrefix}${PREFIX_SEPARATOR}[^${PREFIX_SEPARATOR}]+$`);
  const knownKeys: Set<string> = new Set();

  // Get initial set of keys
  //const existingKeys = await client.keys([keyPrefix + PREFIX_SEPARATOR + '*'].join(''));
  //if (Array.isArray(existingKeys)) {
  //  existingKeys.forEach((key) => {
  //    if (typeof key === 'string' && pattern.test(key)) {
  //      knownKeys.add(key);
  //    }
  //  });
  //}

};

//// Usage example
//async function main() {
//  // Method 2: Polling approach (more reliable)
//  console.log('🔄 Method 2: Polling Approach');
//  const startPolling = await createRedisKeyDetector();
//
//  try {
//    // Start polling in background
//    const stopPolling = startPolling((key: string) => {
//      console.log(`🎯 [Polling] Processing new key: ${key}`);
//    }, 1000);
//
//    stopPolling();
//  } catch (error) {
//    console.error('❌ Error:', error);
//  }
//}
//
//// Run the example
//main().catch(console.error);
