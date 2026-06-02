import type { AppConfig } from '../config.js';
import type { FlashSaleStore } from '../types.js';
import { MemoryStore } from './memoryStore.js';
import { RedisStore } from './redisStore.js';
import { MongoStore } from './mongoStore.js';

export function createStore(config: AppConfig): FlashSaleStore {
  switch (config.storeKind) {
    case 'redis':
      return new RedisStore(config.redisUrl);
    case 'mongo':
      return new MongoStore(config.mongoUrl);
    default:
      return new MemoryStore();
  }
}

export { MemoryStore, RedisStore, MongoStore };
