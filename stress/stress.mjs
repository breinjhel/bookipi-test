/**
 * Throughput / load stress test.
 *
 * Hammers POST /api/flash-sale/purchase with many concurrent connections and
 * unique user IDs, then reports requests/sec and latency percentiles.
 *
 * Usage:
 *   node stress/stress.mjs
 *   BASE_URL=http://localhost:3000 CONNECTIONS=200 DURATION=15 STOCK=100000 node stress/stress.mjs
 */
import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 200);
const DURATION = Number(process.env.DURATION ?? 15);
// Large stock by default so we measure raw throughput rather than sold-out churn.
const STOCK = Number(process.env.STOCK ?? 1_000_000);

async function resetSale(stock) {
  const res = await fetch(`${BASE_URL}/api/admin/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalStock: stock }),
  });
  if (!res.ok) {
    throw new Error(`Failed to reset sale (HTTP ${res.status}). Is the server running?`);
  }
}

async function main() {
  console.log(`Resetting sale with stock=${STOCK} at ${BASE_URL} ...`);
  await resetSale(STOCK);

  console.log(
    `Starting load test: ${CONNECTIONS} connections for ${DURATION}s against ${BASE_URL}\n`,
  );

  const instance = autocannon({
    url: `${BASE_URL}/api/flash-sale/purchase`,
    connections: CONNECTIONS,
    duration: DURATION,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // [<id>] is replaced with an incrementing counter -> unique-ish user IDs.
    idReplacement: true,
    body: JSON.stringify({ userId: 'load-user-[<id>]' }),
    // 2xx + the expected business codes are all "successful handling".
    expectBody: undefined,
  });

  autocannon.track(instance, { renderProgressBar: true, renderResultsTable: true });

  instance.on('done', async (result) => {
    const status = await fetch(`${BASE_URL}/api/flash-sale/status`).then((r) => r.json());
    console.log('\n=== Summary ===');
    console.log(`Requests/sec (avg): ${result.requests.average}`);
    console.log(`Latency p50/p99 (ms): ${result.latency.p50} / ${result.latency.p99}`);
    console.log(`Total requests: ${result.requests.total}`);
    console.log(`2xx responses: ${result['2xx']}`);
    console.log(`Non-2xx responses: ${result.non2xx} (e.g. 409 SOLD_OUT / 403 are expected)`);
    console.log(
      `Inventory after run: sold=${status.soldCount}, remaining=${status.remainingStock}/${status.totalStock}`,
    );
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
