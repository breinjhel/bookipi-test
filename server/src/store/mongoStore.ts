import { randomUUID } from 'node:crypto';
import mongoose, { type Connection, type Model } from 'mongoose';
import type { FlashSaleStore, Order, PurchaseResult } from '../types.js';

const PRODUCT_ID = 'flash-sale-product';

interface InventoryDoc {
  _id: string;
  stock: number;
  total: number;
}

interface OrderDoc {
  userId: string;
  orderId: string;
  purchasedAt: number;
}

const inventorySchema = new mongoose.Schema<InventoryDoc>(
  {
    _id: { type: String, required: true },
    stock: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  { versionKey: false },
);

const orderSchema = new mongoose.Schema<OrderDoc>(
  {
    // Unique index is the database-level guarantee of "one item per user":
    // a second insert for the same userId fails with duplicate-key error.
    userId: { type: String, required: true, unique: true },
    orderId: { type: String, required: true },
    purchasedAt: { type: Number, required: true },
  },
  { versionKey: false },
);

/**
 * Durable store backed by MongoDB. This is the "system of record": orders
 * survive restarts and are queryable for post-sale reporting / fulfillment.
 *
 * Concurrency strategy (no multi-document transaction required, so it works on
 * a standalone mongod):
 *
 *   1. Insert the order first. The UNIQUE index on `userId` makes this the
 *      atomic gate for "one item per user" -> duplicate inserts are rejected
 *      by the database, so concurrent retries from the same user are safe.
 *   2. Atomically claim a unit of stock with a conditional `findOneAndUpdate`
 *      (`{ stock: { $gt: 0 } }` + `$inc: -1`). MongoDB applies this to a single
 *      document atomically, so it can never go negative -> no overselling.
 *   3. If no stock was available, compensate by deleting the reserved order.
 *
 * Trade-off: a process crash between steps 1 and 2 could leave a reserved order
 * without a decremented unit. This is rare and self-correcting on retry
 * (the user gets ALREADY_PURCHASED) and can be reconciled by a sweeper. For
 * the absolute hot path under extreme load we prefer the Redis Lua store; this
 * store optimizes for durability and queryability.
 */
export class MongoStore implements FlashSaleStore {
  private readonly connection: Connection;
  private readonly Inventory: Model<InventoryDoc>;
  private readonly Order: Model<OrderDoc>;
  private ready: Promise<void> | null = null;

  constructor(mongoUrl: string) {
    // Use an isolated connection so multiple instances / tests don't clash
    // with Mongoose's global default connection.
    this.connection = mongoose.createConnection(mongoUrl);
    this.Inventory = this.connection.model<InventoryDoc>('Inventory', inventorySchema);
    this.Order = this.connection.model<OrderDoc>('Order', orderSchema);
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.connection.asPromise();
        await this.Order.init(); // build the unique index before serving traffic
      })();
    }
    return this.ready;
  }

  async init(totalStock: number): Promise<void> {
    await this.ensureReady();
    await this.Inventory.updateOne(
      { _id: PRODUCT_ID },
      { $setOnInsert: { stock: totalStock, total: totalStock } },
      { upsert: true },
    );
  }

  async reset(totalStock: number): Promise<void> {
    await this.ensureReady();
    await Promise.all([
      this.Inventory.updateOne(
        { _id: PRODUCT_ID },
        { $set: { stock: totalStock, total: totalStock } },
        { upsert: true },
      ),
      this.Order.deleteMany({}),
    ]);
  }

  async attemptPurchase(
    userId: string,
    now: number,
    startTime: number,
    endTime: number,
  ): Promise<PurchaseResult> {
    await this.ensureReady();
    if (now < startTime) return { status: 'NOT_STARTED' };
    if (now > endTime) return { status: 'ENDED' };

    const inventory = await this.Inventory.findById(PRODUCT_ID).lean();
    if (!inventory) return { status: 'NOT_INITIALIZED' };

    const order: Order = { userId, orderId: randomUUID(), purchasedAt: now };

    // 1. Reserve the user slot (unique index enforces one-per-user atomically).
    try {
      await this.Order.create(order);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const existing = await this.Order.findOne({ userId }).lean();
        return {
          status: 'ALREADY_PURCHASED',
          order: existing
            ? { userId: existing.userId, orderId: existing.orderId, purchasedAt: existing.purchasedAt }
            : undefined,
        };
      }
      throw err;
    }

    // 2. Atomically claim a unit of stock (cannot go below zero).
    const claimed = await this.Inventory.findOneAndUpdate(
      { _id: PRODUCT_ID, stock: { $gt: 0 } },
      { $inc: { stock: -1 } },
      { new: true },
    ).lean();

    if (!claimed) {
      // 3. Sold out: release the reservation we just created.
      await this.Order.deleteOne({ userId, orderId: order.orderId });
      return { status: 'SOLD_OUT' };
    }

    return { status: 'SUCCESS', order };
  }

  async getOrder(userId: string): Promise<Order | null> {
    await this.ensureReady();
    const doc = await this.Order.findOne({ userId }).lean();
    return doc
      ? { userId: doc.userId, orderId: doc.orderId, purchasedAt: doc.purchasedAt }
      : null;
  }

  async getRemainingStock(): Promise<number> {
    await this.ensureReady();
    const inv = await this.Inventory.findById(PRODUCT_ID).lean();
    return inv?.stock ?? 0;
  }

  async getSoldCount(): Promise<number> {
    await this.ensureReady();
    const inv = await this.Inventory.findById(PRODUCT_ID).lean();
    if (!inv) return 0;
    return inv.total - inv.stock;
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}
