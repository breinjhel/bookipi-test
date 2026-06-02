import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import type { FlashSaleStore } from '../../src/types.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const now = Date.now();
  return {
    port: 0,
    host: '127.0.0.1',
    storeKind: 'memory',
    redisUrl: 'redis://127.0.0.1:6379',
    mongoUrl: 'mongodb://127.0.0.1:27017/flashsale-test',
    totalStock: 5,
    saleStart: now - 1000,
    saleEnd: now + 60 * 60 * 1000,
    enableAdmin: true,
    ...overrides,
  };
}

describe('Flash sale API (integration)', () => {
  let app: Express;
  let store: FlashSaleStore;

  beforeAll(async () => {
    ({ app, store } = await buildApp(makeConfig()));
  });

  afterAll(async () => {
    await store.close();
  });

  it('reports active status with full stock', async () => {
    await request(app).post('/api/admin/reset').send({ totalStock: 5 });
    const res = await request(app).get('/api/flash-sale/status');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('active');
    expect(res.body.remainingStock).toBe(5);
    expect(res.body.totalStock).toBe(5);
  });

  it('completes a purchase and is idempotent per user', async () => {
    await request(app).post('/api/admin/reset').send({ totalStock: 5 });

    const buy = await request(app).post('/api/flash-sale/purchase').send({ userId: 'alice' });
    expect(buy.status).toBe(201);
    expect(buy.body.status).toBe('SUCCESS');
    const orderId = buy.body.order.orderId;

    const again = await request(app).post('/api/flash-sale/purchase').send({ userId: 'alice' });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('ALREADY_PURCHASED');
    expect(again.body.order.orderId).toBe(orderId);
  });

  it('lets a user check whether they secured an item', async () => {
    await request(app).post('/api/admin/reset').send({ totalStock: 5 });
    await request(app).post('/api/flash-sale/purchase').send({ userId: 'carol' });

    const found = await request(app).get('/api/flash-sale/purchase/carol');
    expect(found.status).toBe(200);
    expect(found.body.purchased).toBe(true);

    const missing = await request(app).get('/api/flash-sale/purchase/nobody');
    expect(missing.status).toBe(404);
    expect(missing.body.purchased).toBe(false);
  });

  it('returns SOLD_OUT once stock is exhausted', async () => {
    await request(app).post('/api/admin/reset').send({ totalStock: 2 });
    await request(app).post('/api/flash-sale/purchase').send({ userId: 'u1' });
    await request(app).post('/api/flash-sale/purchase').send({ userId: 'u2' });
    const soldOut = await request(app).post('/api/flash-sale/purchase').send({ userId: 'u3' });
    expect(soldOut.status).toBe(409);
    expect(soldOut.body.status).toBe('SOLD_OUT');

    const status = await request(app).get('/api/flash-sale/status');
    expect(status.body.state).toBe('sold_out');
  });

  it('rejects invalid input', async () => {
    const res = await request(app).post('/api/flash-sale/purchase').send({});
    expect(res.status).toBe(400);
  });
});

describe('Flash sale window enforcement', () => {
  it('blocks purchases before the sale starts', async () => {
    const now = Date.now();
    const { app, store } = await buildApp(
      makeConfig({ saleStart: now + 60_000, saleEnd: now + 120_000 }),
    );
    const res = await request(app).post('/api/flash-sale/purchase').send({ userId: 'early-bird' });
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('NOT_STARTED');
    const status = await request(app).get('/api/flash-sale/status');
    expect(status.body.state).toBe('upcoming');
    await store.close();
  });

  it('blocks purchases after the sale ends', async () => {
    const now = Date.now();
    const { app, store } = await buildApp(
      makeConfig({ saleStart: now - 120_000, saleEnd: now - 60_000 }),
    );
    const res = await request(app).post('/api/flash-sale/purchase').send({ userId: 'late-comer' });
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('ENDED');
    await store.close();
  });
});
