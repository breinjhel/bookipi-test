import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import type { AppConfig } from './config.js';
import { FlashSaleService } from './service.js';
import { createStore } from './store/index.js';
import type { FlashSaleStore, PurchaseStatus } from './types.js';

/** Map a business outcome to an HTTP status code. */
const STATUS_HTTP: Record<PurchaseStatus, number> = {
  SUCCESS: 201,
  ALREADY_PURCHASED: 200,
  SOLD_OUT: 409,
  NOT_STARTED: 403,
  ENDED: 403,
  NOT_INITIALIZED: 503,
};

const STATUS_MESSAGE: Record<PurchaseStatus, string> = {
  SUCCESS: 'Purchase successful. You secured an item!',
  ALREADY_PURCHASED: 'You have already purchased an item.',
  SOLD_OUT: 'Sorry, the product is sold out.',
  NOT_STARTED: 'The flash sale has not started yet.',
  ENDED: 'The flash sale has ended.',
  NOT_INITIALIZED: 'The flash sale is not ready yet. Please try again shortly.',
};

const USER_ID_MAX = 128;

export interface BuiltApp {
  app: Express;
  service: FlashSaleService;
  store: FlashSaleStore;
}

/** Wrap an async route so rejected promises reach the error handler. */
function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export async function buildApp(config: AppConfig): Promise<BuiltApp> {
  const store = createStore(config);
  const service = new FlashSaleService(store, config);
  await service.init();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get(
    '/api/flash-sale/status',
    asyncRoute(async (_req, res) => {
      res.json(await service.getStatus());
    }),
  );

  app.post(
    '/api/flash-sale/purchase',
    asyncRoute(async (req, res) => {
      const raw = (req.body ?? {}) as { userId?: unknown };
      if (typeof raw.userId !== 'string' || raw.userId.trim().length === 0) {
        res.status(400).json({ status: 'INVALID', message: 'A non-empty userId is required.' });
        return;
      }
      const userId = raw.userId.trim();
      if (userId.length > USER_ID_MAX) {
        res
          .status(400)
          .json({ status: 'INVALID', message: `userId must be <= ${USER_ID_MAX} chars.` });
        return;
      }

      const result = await service.attemptPurchase(userId);
      res.status(STATUS_HTTP[result.status]).json({
        status: result.status,
        success: result.status === 'SUCCESS' || result.status === 'ALREADY_PURCHASED',
        message: STATUS_MESSAGE[result.status],
        order: result.order ?? null,
      });
    }),
  );

  app.get(
    '/api/flash-sale/purchase/:userId',
    asyncRoute(async (req, res) => {
      const userId = String(req.params.userId).trim();
      const order = await service.getUserOrder(userId);
      if (!order) {
        res
          .status(404)
          .json({ purchased: false, message: 'No purchase found for this user.', order: null });
        return;
      }
      res.json({ purchased: true, message: 'You have secured an item.', order });
    }),
  );

  if (config.enableAdmin) {
    app.post(
      '/api/admin/reset',
      asyncRoute(async (req, res) => {
        const totalStock = (req.body ?? {}).totalStock;
        await service.reset(typeof totalStock === 'number' ? totalStock : undefined);
        res.json({ message: 'Flash sale reset.', status: await service.getStatus() });
      }),
    );
  }

  // Centralized error handler.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', err);
    res.status(500).json({ status: 'ERROR', message: 'Internal server error.' });
  });

  return { app, service, store };
}
