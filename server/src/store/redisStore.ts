import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { FlashSaleStore, Order, PurchaseResult, PurchaseStatus } from '../types.js';

const STOCK_KEY = 'flashsale:stock';
const TOTAL_KEY = 'flashsale:total';
const ORDERS_KEY = 'flashsale:orders'; // hash: userId -> JSON(order)

/**
 * Atomic purchase script.
 *
 * Redis executes a Lua script as a single, isolated, atomic unit (Redis is
 * single-threaded for command execution). This collapses "check window ->
 * check duplicate buyer -> check stock -> decrement -> record order" into one
 * indivisible operation. No locks, no read-modify-write races, no overselling,
 * even with thousands of concurrent clients across many API instances.
 *
 * KEYS[1] = stock key, KEYS[2] = orders hash key
 * ARGV[1] = userId, ARGV[2] = now, ARGV[3] = start, ARGV[4] = end, ARGV[5] = orderId
 * Returns: { status, orderJsonOrEmpty }
 */
const PURCHASE_SCRIPT = `
local now = tonumber(ARGV[2])
local startTime = tonumber(ARGV[3])
local endTime = tonumber(ARGV[4])

local stock = redis.call('GET', KEYS[1])
if stock == false then
  return {'NOT_INITIALIZED', ''}
end

if now < startTime then
  return {'NOT_STARTED', ''}
end
if now > endTime then
  return {'ENDED', ''}
end

local existing = redis.call('HGET', KEYS[2], ARGV[1])
if existing then
  return {'ALREADY_PURCHASED', existing}
end

if tonumber(stock) <= 0 then
  return {'SOLD_OUT', ''}
end

redis.call('DECR', KEYS[1])
local order = cjson.encode({ userId = ARGV[1], orderId = ARGV[5], purchasedAt = now })
redis.call('HSET', KEYS[2], ARGV[1], order)
return {'SUCCESS', order}
`;

export class RedisStore implements FlashSaleStore {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }

  async init(totalStock: number): Promise<void> {
    // SET NX => only initialize if not already present (survives restarts).
    const created = await this.redis.set(STOCK_KEY, totalStock, 'NX');
    if (created) {
      await this.redis.set(TOTAL_KEY, totalStock);
    }
  }

  async reset(totalStock: number): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.set(STOCK_KEY, totalStock);
    pipeline.set(TOTAL_KEY, totalStock);
    pipeline.del(ORDERS_KEY);
    await pipeline.exec();
  }

  async attemptPurchase(
    userId: string,
    now: number,
    startTime: number,
    endTime: number,
  ): Promise<PurchaseResult> {
    const result = (await this.redis.eval(
      PURCHASE_SCRIPT,
      2,
      STOCK_KEY,
      ORDERS_KEY,
      userId,
      String(now),
      String(startTime),
      String(endTime),
      randomUUID(),
    )) as [string, string];

    const status = result[0] as PurchaseStatus;
    const payload = result[1];
    if ((status === 'SUCCESS' || status === 'ALREADY_PURCHASED') && payload) {
      return { status, order: JSON.parse(payload) as Order };
    }
    return { status };
  }

  async getOrder(userId: string): Promise<Order | null> {
    const raw = await this.redis.hget(ORDERS_KEY, userId);
    return raw ? (JSON.parse(raw) as Order) : null;
  }

  async getRemainingStock(): Promise<number> {
    const raw = await this.redis.get(STOCK_KEY);
    return raw ? Number(raw) : 0;
  }

  async getSoldCount(): Promise<number> {
    const [total, remaining] = await Promise.all([
      this.redis.get(TOTAL_KEY),
      this.redis.get(STOCK_KEY),
    ]);
    return (total ? Number(total) : 0) - (remaining ? Number(remaining) : 0);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
