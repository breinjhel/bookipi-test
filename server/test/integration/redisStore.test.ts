import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { RedisStore } from '../../src/store/redisStore.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

async function redisAvailable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  probe.on('error', () => {
    /* swallow connection errors during availability probe */
  });
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    probe.disconnect();
    return false;
  }
}

const available = await redisAvailable();
const NOW = Date.now();
const START = 0;
const END = Number.MAX_SAFE_INTEGER;

// These tests only run when a Redis instance is reachable (e.g. `docker compose up`).
describe.skipIf(!available)('RedisStore (atomic Lua)', () => {
  let store: RedisStore;

  beforeAll(() => {
    store = new RedisStore(REDIS_URL);
  });

  afterAll(async () => {
    await store.close();
  });

  it('never oversells under heavy concurrency', async () => {
    await store.reset(100);
    const attempts = Array.from({ length: 10_000 }, (_, i) =>
      store.attemptPurchase(`redis-user-${i}`, NOW, START, END),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 'SUCCESS').length;
    expect(successes).toBe(100);
    expect(await store.getRemainingStock()).toBe(0);
    expect(await store.getSoldCount()).toBe(100);
  });

  it('enforces one item per user under concurrency', async () => {
    await store.reset(1000);
    const attempts = Array.from({ length: 2000 }, (_, i) =>
      store.attemptPurchase(`dup-${i % 5}`, NOW, START, END),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 'SUCCESS').length;
    expect(successes).toBe(5);
    expect(await store.getSoldCount()).toBe(5);
  });
});
