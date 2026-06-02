import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoStore } from '../../src/store/mongoStore.js';

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/flashsale-test';

async function mongoAvailable(): Promise<boolean> {
  try {
    const conn = await mongoose.createConnection(MONGO_URL, {
      serverSelectionTimeoutMS: 800,
    }).asPromise();
    await conn.close();
    return true;
  } catch {
    return false;
  }
}

const available = await mongoAvailable();
const NOW = Date.now();
const START = 0;
const END = Number.MAX_SAFE_INTEGER;

// Only runs when a MongoDB instance is reachable (e.g. `docker compose up`).
describe.skipIf(!available)('MongoStore (atomic findOneAndUpdate + unique index)', () => {
  let store: MongoStore;

  beforeAll(() => {
    store = new MongoStore(MONGO_URL);
  });

  afterAll(async () => {
    await store.close();
  });

  it('never oversells under heavy concurrency', async () => {
    await store.reset(100);
    const attempts = Array.from({ length: 3000 }, (_, i) =>
      store.attemptPurchase(`mongo-user-${i}`, NOW, START, END),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 'SUCCESS').length;
    expect(successes).toBe(100);
    expect(await store.getRemainingStock()).toBe(0);
    expect(await store.getSoldCount()).toBe(100);
  });

  it('enforces one item per user under concurrency', async () => {
    await store.reset(1000);
    const attempts = Array.from({ length: 1000 }, (_, i) =>
      store.attemptPurchase(`mongo-dup-${i % 5}`, NOW, START, END),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 'SUCCESS').length;
    expect(successes).toBe(5);
    expect(await store.getSoldCount()).toBe(5);
  });
});
