/**
 * Concurrency-correctness stress test.
 *
 * This is the test that actually *proves* the core invariants under load:
 *   1. No overselling: successful purchases === initial stock (never more).
 *   2. One item per user: a single user firing many concurrent requests wins
 *      at most one unit.
 *
 * Unlike the throughput test, this fires a precise, known number of concurrent
 * requests and asserts on the exact outcome.
 *
 * Usage:
 *   node stress/verify-correctness.mjs
 *   BASE_URL=http://localhost:3000 STOCK=100 USERS=5000 node stress/verify-correctness.mjs
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const STOCK = Number(process.env.STOCK ?? 100);
const USERS = Number(process.env.USERS ?? 5000);
// How many duplicate requests each "spammer" user fires simultaneously.
const DUP_PER_USER = Number(process.env.DUP_PER_USER ?? 20);

async function reset(stock) {
  const res = await fetch(`${BASE_URL}/api/admin/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalStock: stock }),
  });
  if (!res.ok) throw new Error(`reset failed (HTTP ${res.status}) - is the server running?`);
}

async function purchase(userId) {
  const res = await fetch(`${BASE_URL}/api/flash-sale/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const body = await res.json();
  return body.status;
}

// Cap simultaneous in-flight requests so the *client* (a single Node process)
// doesn't exhaust local ephemeral sockets. This still keeps hundreds of
// requests racing at once, which is what stresses the server's concurrency
// control. Lower it on machines with tight socket limits (e.g. Windows).
const CLIENT_CONCURRENCY = Number(process.env.CLIENT_CONCURRENCY ?? 500);

async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function tally(statuses) {
  return statuses.reduce((acc, s) => {
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
}

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
  } else {
    console.error(`  FAIL: ${msg}`);
    failures += 1;
  }
}

async function testNoOversell() {
  console.log(`\n[Test 1] No oversell: ${USERS} distinct users vs stock=${STOCK}`);
  await reset(STOCK);
  const t0 = Date.now();
  const statuses = await runPool(
    Array.from({ length: USERS }, (_, i) => () => purchase(`unique-user-${i}`)),
    CLIENT_CONCURRENCY,
  );
  const elapsed = Date.now() - t0;
  const counts = tally(statuses);
  console.log('  Outcomes:', counts, `(${elapsed}ms)`);

  const status = await fetch(`${BASE_URL}/api/flash-sale/status`).then((r) => r.json());
  assert((counts.SUCCESS ?? 0) === STOCK, `exactly ${STOCK} SUCCESS (got ${counts.SUCCESS ?? 0})`);
  assert(status.remainingStock === 0, `remaining stock is 0 (got ${status.remainingStock})`);
  assert(status.soldCount === STOCK, `sold count is ${STOCK} (got ${status.soldCount})`);
  assert(
    (counts.SUCCESS ?? 0) + (counts.SOLD_OUT ?? 0) === USERS,
    'every request got a definitive SUCCESS or SOLD_OUT',
  );
}

async function testOnePerUser() {
  console.log(
    `\n[Test 2] One item per user: ${STOCK} spammers x ${DUP_PER_USER} concurrent requests each`,
  );
  await reset(STOCK);
  const spammers = Math.min(STOCK, 50); // each must be able to win exactly one
  const requests = [];
  for (let u = 0; u < spammers; u++) {
    for (let d = 0; d < DUP_PER_USER; d++) {
      const userId = `spammer-${u}`;
      requests.push(() => purchase(userId));
    }
  }
  const statuses = await runPool(requests, CLIENT_CONCURRENCY);
  const counts = tally(statuses);
  console.log('  Outcomes:', counts);

  assert(
    (counts.SUCCESS ?? 0) === spammers,
    `each of ${spammers} users won exactly once (got ${counts.SUCCESS ?? 0} successes)`,
  );
  const status = await fetch(`${BASE_URL}/api/flash-sale/status`).then((r) => r.json());
  assert(status.soldCount === spammers, `sold count equals distinct winners (${status.soldCount})`);
}

async function main() {
  console.log(`Concurrency correctness check against ${BASE_URL}`);
  await testNoOversell();
  await testOnePerUser();

  console.log('\n========================================');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED — no overselling, one item per user upheld under load.');
    process.exit(0);
  } else {
    console.error(`${failures} CHECK(S) FAILED.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
