import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/store/memoryStore.js';

const NOW = 1_000_000;
const START = 0;
const END = Number.MAX_SAFE_INTEGER;

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init(10);
  });

  it('grants stock until sold out', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await store.attemptPurchase(`user-${i}`, NOW, START, END);
      expect(res.status).toBe('SUCCESS');
      expect(res.order?.userId).toBe(`user-${i}`);
    }
    const sold = await store.attemptPurchase('user-late', NOW, START, END);
    expect(sold.status).toBe('SOLD_OUT');
    expect(await store.getRemainingStock()).toBe(0);
    expect(await store.getSoldCount()).toBe(10);
  });

  it('enforces one item per user (idempotent)', async () => {
    const first = await store.attemptPurchase('alice', NOW, START, END);
    expect(first.status).toBe('SUCCESS');
    const second = await store.attemptPurchase('alice', NOW, START, END);
    expect(second.status).toBe('ALREADY_PURCHASED');
    expect(second.order?.orderId).toBe(first.order?.orderId);
    // a duplicate must not consume stock
    expect(await store.getSoldCount()).toBe(1);
  });

  it('respects the sale window', async () => {
    const upcoming = await store.attemptPurchase('bob', 50, 100, 200);
    expect(upcoming.status).toBe('NOT_STARTED');
    const ended = await store.attemptPurchase('bob', 300, 100, 200);
    expect(ended.status).toBe('ENDED');
  });

  it('never oversells under high concurrency', async () => {
    const fresh = new MemoryStore();
    await fresh.init(50);
    const attempts = Array.from({ length: 5000 }, (_, i) =>
      fresh.attemptPurchase(`u-${i}`, NOW, START, END),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 'SUCCESS').length;
    expect(successes).toBe(50);
    expect(await fresh.getRemainingStock()).toBe(0);
  });

  it('allows duplicate users to retry without consuming stock under concurrency', async () => {
    const fresh = new MemoryStore();
    await fresh.init(100);
    // 1000 concurrent attempts from only 10 distinct users
    const attempts = Array.from({ length: 1000 }, (_, i) =>
      fresh.attemptPurchase(`user-${i % 10}`, NOW, START, END),
    );
    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 'SUCCESS').length;
    expect(successes).toBe(10); // exactly one success per distinct user
    expect(await fresh.getSoldCount()).toBe(10);
  });
});
