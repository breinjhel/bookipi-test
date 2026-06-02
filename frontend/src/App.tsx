import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  attemptPurchase,
  checkPurchase,
  fetchStatus,
  type Order,
  type SaleState,
  type SaleStatus,
} from './api.js';

const STATE_LABEL: Record<SaleState, string> = {
  upcoming: 'Upcoming',
  active: 'Live now',
  sold_out: 'Sold out',
  ended: 'Ended',
};

type Feedback = { kind: 'success' | 'info' | 'error'; message: string };

function useCountdown(target: number | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (target === null) return '';
  const diff = Math.max(0, target - Date.now());
  const s = Math.floor(diff / 1000) % 60;
  const m = Math.floor(diff / 60000) % 60;
  const h = Math.floor(diff / 3600000);
  return `${h}h ${m}m ${s}s`;
}

export function App() {
  const [status, setStatus] = useState<SaleStatus | null>(null);
  const [userId, setUserId] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
    } catch {
      /* transient; keep last known status */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = setInterval(refreshStatus, 2000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  const countdownTarget = useMemo(() => {
    if (!status) return null;
    if (status.state === 'upcoming') return status.startTime;
    if (status.state === 'active') return status.endTime;
    return null;
  }, [status]);
  const countdown = useCountdown(countdownTarget);

  const handleBuy = useCallback(async () => {
    const trimmed = userId.trim();
    if (!trimmed) {
      setFeedback({ kind: 'error', message: 'Please enter a user identifier first.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await attemptPurchase(trimmed);
      setOrder(res.order);
      setFeedback({
        kind: res.status === 'SUCCESS' ? 'success' : res.success ? 'info' : 'error',
        message: res.message,
      });
      void refreshStatus();
    } catch {
      setFeedback({ kind: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }, [userId, refreshStatus]);

  const handleCheck = useCallback(async () => {
    const trimmed = userId.trim();
    if (!trimmed) {
      setFeedback({ kind: 'error', message: 'Enter a user identifier to check.' });
      return;
    }
    const res = await checkPurchase(trimmed);
    setOrder(res.order);
    setFeedback({ kind: res.purchased ? 'success' : 'info', message: res.message });
  }, [userId]);

  const soldPct = status ? Math.round((status.soldCount / status.totalStock) * 100) : 0;
  const canBuy = status?.state === 'active' && !submitting;

  return (
    <div className="page">
      <main className="card">
        <header className="card__header">
          <h1>⚡ Flash Sale</h1>
          {status && (
            <span className={`badge badge--${status.state}`}>{STATE_LABEL[status.state]}</span>
          )}
        </header>

        <section className="product">
          <div className="product__image" aria-hidden>🎧</div>
          <div className="product__info">
            <h2>Limited Edition Headphones</h2>
            <p className="product__sub">One unit per customer. While stocks last.</p>
          </div>
        </section>

        {status && (
          <section className="stock">
            <div className="stock__bar">
              <div className="stock__fill" style={{ width: `${soldPct}%` }} />
            </div>
            <div className="stock__meta">
              <span>
                <strong>{status.remainingStock}</strong> / {status.totalStock} left
              </span>
              <span>{status.soldCount} sold</span>
            </div>
            {countdown && (
              <p className="countdown">
                {status.state === 'upcoming' ? 'Starts in' : 'Ends in'} <strong>{countdown}</strong>
              </p>
            )}
          </section>
        )}

        <section className="form">
          <label htmlFor="userId">User identifier (username or email)</label>
          <input
            id="userId"
            type="text"
            placeholder="e.g. ada@example.com"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={submitting}
          />
          <div className="form__actions">
            <button className="btn btn--primary" onClick={handleBuy} disabled={!canBuy}>
              {submitting ? 'Processing…' : 'Buy Now'}
            </button>
            <button className="btn btn--ghost" onClick={handleCheck} disabled={submitting}>
              Check my order
            </button>
          </div>
          {!canBuy && status && status.state !== 'active' && (
            <p className="hint">Purchasing is only available while the sale is live.</p>
          )}
        </section>

        {feedback && <div className={`alert alert--${feedback.kind}`}>{feedback.message}</div>}

        {order && (
          <div className="receipt">
            <h3>🎟️ Your order</h3>
            <dl>
              <div>
                <dt>Order ID</dt>
                <dd>{order.orderId}</dd>
              </div>
              <div>
                <dt>User</dt>
                <dd>{order.userId}</dd>
              </div>
              <div>
                <dt>Secured at</dt>
                <dd>{new Date(order.purchasedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        )}
      </main>
      <footer className="footnote">Backend: Node + Express · Redis/MongoDB · React frontend</footer>
    </div>
  );
}
