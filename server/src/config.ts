export type StoreKind = 'memory' | 'redis' | 'mongo';

export interface AppConfig {
  port: number;
  host: string;
  storeKind: StoreKind;
  redisUrl: string;
  mongoUrl: string;
  totalStock: number;
  saleStart: number;
  saleEnd: number;
  /** Allow the /api/admin/reset endpoint (useful for tests + stress runs). */
  enableAdmin: boolean;
}

function parseStoreKind(value: string | undefined): StoreKind {
  if (value === 'redis' || value === 'mongo') return value;
  return 'memory';
}

function parseTime(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  // Accept either an ISO date string or an epoch-millis number.
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value.trim() !== '') return asNumber;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const now = Date.now();
  // Default: sale is active immediately and runs for 2 hours, so the demo and
  // stress tests work out-of-the-box without configuring timestamps.
  const saleStart = parseTime(env.SALE_START, now);
  const saleEnd = parseTime(env.SALE_END, saleStart + 2 * 60 * 60 * 1000);

  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    storeKind: parseStoreKind(env.STORE),
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    mongoUrl: env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/flashsale',
    totalStock: Number(env.TOTAL_STOCK ?? 100),
    saleStart,
    saleEnd,
    enableAdmin: env.ENABLE_ADMIN !== 'false',
  };
}
