#!/usr/bin/env node
// Mint an agent token over HTTP: `npm run mint -- <name>`.
// HTTP-only on purpose — opening the PGLite data dir from a second process
// would corrupt it. Reads ADMIN__SECRET (+ optional BASE_URL) from env or .env;
// without BASE_URL it targets PUBLIC_BASE_URL, i.e. wherever `npm run dev` bound.
import { loadDotEnv, resolveBaseUrl } from './lib/dev-env.mjs';

loadDotEnv();
const base = resolveBaseUrl();
const secret = process.env.ADMIN__SECRET;
if (!secret) {
  console.error('ADMIN__SECRET is not set (env or .env). Cannot mint.');
  process.exit(1);
}

const name = process.argv[2];
const res = await fetch(`${base}/api/tokens`, {
  method: 'POST',
  headers: { 'x-shared-secret': secret, 'Content-Type': 'application/json' },
  body: JSON.stringify(name ? { name } : {}),
});
if (!res.ok) {
  console.error(`Mint failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { id, token } = await res.json();
console.log(`Minted token ${id}${name ? ` (${name})` : ''} — shown ONCE, store it now:\n`);
console.log(token);
console.log(`\nHand to an agent with: "Read ${base}/api and use token ${token.slice(0, 10)}..."`);
