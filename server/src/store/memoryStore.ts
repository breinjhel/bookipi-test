import { randomUUID } from 'node:crypto';
import type { FlashSaleStore, Order, PurchaseResult } from '../types.js';

/**
 * In-process store.
 *
 * Correctness note: Node.js runs JavaScript on a single thread. As long as
 * `attemptPurchase` performs all of its read-check-write logic synchronously
 * (no `await` between checking stock and decrementing it), the operation is
 * effectively atomic within one process and cannot oversell or double-sell.
 *
 * Limitation: this only holds for a *single* process. To scale horizontally
 * across many API instances you need a shared atomic store -> see RedisStore.
 */
export class MemoryStore implements FlashSaleStore {
  private remaining = 0;
  private total = 0;
  private readonly orders = new Map<string, Order>();
  private initialized = false;

  async init(totalStock: number): Promise<void> {
    if (this.initialized) return;
    this.total = totalStock;
    this.remaining = totalStock;
    this.initialized = true;
  }

  async reset(totalStock: number): Promise<void> {
    this.total = totalStock;
    this.remaining = totalStock;
    this.orders.clear();
    this.initialized = true;
  }

  async attemptPurchase(
    userId: string,
    now: number,
    startTime: number,
    endTime: number,
  ): Promise<PurchaseResult> {
    if (!this.initialized) return { status: 'NOT_INITIALIZED' };
    if (now < startTime) return { status: 'NOT_STARTED' };
    if (now > endTime) return { status: 'ENDED' };

    // --- critical section (fully synchronous, hence atomic) ---
    const existing = this.orders.get(userId);
    if (existing) return { status: 'ALREADY_PURCHASED', order: existing };

    if (this.remaining <= 0) return { status: 'SOLD_OUT' };

    this.remaining -= 1;
    const order: Order = { userId, orderId: randomUUID(), purchasedAt: now };
    this.orders.set(userId, order);
    // --- end critical section ---

    return { status: 'SUCCESS', order };
  }

  async getOrder(userId: string): Promise<Order | null> {
    return this.orders.get(userId) ?? null;
  }

  async getRemainingStock(): Promise<number> {
    return this.remaining;
  }

  async getSoldCount(): Promise<number> {
    return this.total - this.remaining;
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
