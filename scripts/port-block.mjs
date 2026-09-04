#!/usr/bin/env node
/**
 * THE NEXT FREE PORT BLOCK for a parallel dev server: 100 ports starting at an
 * even hundred (5000, 5200, 5400, …), so blocks never touch and a port
 * derived by "+100" from one block lands in the gap, never in the next block.
 * A block is free only if EVERY port in it binds right now — not a guess.
 *
 *   node scripts/port-block.mjs            → 5000
 *   node scripts/port-block.mjs --count 3  → 5000 5200 5400
 *   node scripts/port-block.mjs --from 7000
 *   node scripts/port-block.mjs --env       → the block as the env lines a brief pastes verbatim
 */
import net from 'node:net';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const from = Number(arg('--from', '5000'));
const count = Number(arg('--count', '1'));
const SIZE = 100, STEP = 200, CEILING = 65_000;

const binds = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});
const blockFree = async (base) => (await Promise.all(Array.from({ length: SIZE }, (_, i) => binds(base + i)))).every(Boolean);

const found = [];
for (let base = Math.ceil(from / STEP) * STEP; base + SIZE <= CEILING && found.length < count; base += STEP) {
  if (await blockFree(base)) found.push(base);
}
if (found.length < count) { console.error(`only ${found.length} free block(s) from ${from}`); process.exit(1); }
if (!process.argv.includes('--env')) { console.log(found.join(' ')); process.exit(0); }
for (const base of found) {
  const p = (n) => base + n;
  console.log(`# port block ${base}–${base + SIZE - 1}: every port this agent may bind
APP__PORT=${p(1)}
APP__HMR_PORT=${p(2)}
APP__PUBLIC_BASE_URL=http://localhost:${p(1)}
PROXY__PORT=${p(0)}                      # the only published port when a proxy fronts the app
SQL__SERVICE_URL=http://127.0.0.1:${p(10)}
BROWSER__SERVICE_URL=http://127.0.0.1:${p(11)}
EVENTS__SERVICE_URL=http://127.0.0.1:${p(12)}
POSTGRES_PORT=${p(32)}
MINIO_PORT=${p(90)}
MINIO_CONSOLE_PORT=${p(91)}
# ${p(20)}–${p(29)} free for throwaway servers; ${p(40)}–${p(89)} free for compose host bindings
`);
}
