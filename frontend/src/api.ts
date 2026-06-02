export type SaleState = 'upcoming' | 'active' | 'sold_out' | 'ended';

export interface SaleStatus {
  state: SaleState;
  startTime: number;
  endTime: number;
  totalStock: number;
  remainingStock: number;
  soldCount: number;
  now: number;
}

export interface Order {
  userId: string;
  orderId: string;
  purchasedAt: number;
}

export interface PurchaseResponse {
  status: string;
  success: boolean;
  message: string;
  order: Order | null;
}

const BASE = import.meta.env.VITE_API_BASE ?? '';

export async function fetchStatus(): Promise<SaleStatus> {
  const res = await fetch(`${BASE}/api/flash-sale/status`);
  if (!res.ok) throw new Error('Failed to load sale status');
  return res.json();
}

export async function attemptPurchase(userId: string): Promise<PurchaseResponse> {
  const res = await fetch(`${BASE}/api/flash-sale/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  // The API encodes business outcomes in the body, so parse regardless of code.
  return res.json();
}

export async function checkPurchase(
  userId: string,
): Promise<{ purchased: boolean; message: string; order: Order | null }> {
  const res = await fetch(`${BASE}/api/flash-sale/purchase/${encodeURIComponent(userId)}`);
  return res.json();
}
