/**
 * Outcome of a purchase attempt. These values are produced atomically by the
 * underlying store so they are authoritative even under heavy concurrency.
 */
export type PurchaseStatus =
  | 'SUCCESS'
  | 'ALREADY_PURCHASED'
  | 'SOLD_OUT'
  | 'NOT_STARTED'
  | 'ENDED'
  | 'NOT_INITIALIZED';

export type SaleState = 'upcoming' | 'active' | 'sold_out' | 'ended';

export interface Order {
  userId: string;
  orderId: string;
  purchasedAt: number;
}

export interface PurchaseResult {
  status: PurchaseStatus;
  order?: Order;
}

export interface SaleStatus {
  state: SaleState;
  startTime: number;
  endTime: number;
  totalStock: number;
  remainingStock: number;
  soldCount: number;
  now: number;
}

/**
 * Storage abstraction for the flash sale. The contract is intentionally small:
 * the *only* mutating operation (`attemptPurchase`) must be atomic so that the
 * "limited stock" and "one item per user" invariants hold under concurrency.
 */
export interface FlashSaleStore {
  /** Initialize stock only if not already initialized (idempotent on boot). */
  init(totalStock: number): Promise<void>;
  /** Force-reset stock and clear buyers. Used by tests / admin / stress runs. */
  reset(totalStock: number): Promise<void>;
  attemptPurchase(
    userId: string,
    now: number,
    startTime: number,
    endTime: number,
  ): Promise<PurchaseResult>;
  getOrder(userId: string): Promise<Order | null>;
  getRemainingStock(): Promise<number>;
  getSoldCount(): Promise<number>;
  close(): Promise<void>;
}
