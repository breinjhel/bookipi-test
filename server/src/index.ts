import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

// Load server/.env regardless of the current working directory. Resolving
// relative to this file means it works both in dev (src/) and prod (dist/),
// since .env sits one level up from each. Must run before loadConfig().
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, store } = await buildApp(config);

  const server: Server = app.listen(config.port, config.host, () => {
    console.log(
      `[flash-sale] listening on http://${config.host}:${config.port} ` +
        `(store=${config.storeKind}, stock=${config.totalStock}, ` +
        `window=${new Date(config.saleStart).toISOString()} -> ${new Date(
          config.saleEnd,
        ).toISOString()})`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[flash-sale] received ${signal}, shutting down...`);
    server.close(() => {
      void store.close().finally(() => process.exit(0));
    });
    // Force-exit if connections linger.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
