import type { AppConfig } from './config.js';
import type {
  FlashSaleStore,
  Order,
  PurchaseResult,
  SaleState,
  SaleStatus,
} from './types.js';

/**
 * Thin orchestration layer over the store. Keeps the HTTP layer free of
 * business rules and makes the logic trivially unit-testable against either
 * the memory or Redis store.
 */
export class FlashSaleService {
  constructor(
    private readonly store: FlashSaleStore,
    private readonly config: AppConfig,
  ) {}

  async init(): Promise<void> {
    await this.store.init(this.config.totalStock);
  }

  async reset(totalStock?: number): Promise<void> {
    await this.store.reset(totalStock ?? this.config.totalStock);
  }

  private deriveState(now: number, remaining: number): SaleState {
    if (now < this.config.saleStart) return 'upcoming';
    if (now > this.config.saleEnd) return 'ended';
    if (remaining <= 0) return 'sold_out';
    return 'active';
  }

  async getStatus(now: number = Date.now()): Promise<SaleStatus> {
    const [remaining, sold] = await Promise.all([
      this.store.getRemainingStock(),
      this.store.getSoldCount(),
    ]);
    return {
      state: this.deriveState(now, remaining),
      startTime: this.config.saleStart,
      endTime: this.config.saleEnd,
      // Derive total from the store so it stays consistent after an admin reset
      // that changes the stock level.
      totalStock: remaining + sold,
      remainingStock: remaining,
      soldCount: sold,
      now,
    };
  }

  async attemptPurchase(userId: string, now: number = Date.now()): Promise<PurchaseResult> {
    return this.store.attemptPurchase(
      userId,
      now,
      this.config.saleStart,
      this.config.saleEnd,
    );
  }

  async getUserOrder(userId: string): Promise<Order | null> {
    return this.store.getOrder(userId);
  }
}
