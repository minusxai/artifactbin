#!/usr/bin/env node
// `npm run dev:otp -- <email>`: print the latest unexpired local login code for that address from the protected
// development outbox `npm run dev` writes (.artifactbin/dev-mail.jsonl). A loopback public URL never sends mail.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('usage: npm run dev:otp -- <email>');
  process.exit(2);
}

const outboxPath = path.join(ROOT, '.artifactbin', 'dev-mail.jsonl');
let records = [];
try {
  records = fs.readFileSync(outboxPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const now = Date.now();
const message = records.findLast((record) =>
  record.kind === 'otp'
  && String(record.to).toLowerCase() === email
  && typeof record.otp === 'string'
  && Date.parse(record.expiresAt) > now);
if (!message) {
  console.error(`no unexpired development OTP for ${email}; request a new login code first`);
  process.exit(1);
}
console.log(message.otp);
