import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireCredential } from '../lib/credential.ts';

const received = 'https://api.resend.com/emails/receiving';

afterEach(() => vi.useRealTimers());

it('acquires a credential through the normal local outbox login path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifactbin-otp-inbox-'));
  const outbox = join(directory, 'outbox.jsonl');
  const email = 'mxmx_eval_disposable@example.test';
  await writeFile(outbox, [
    JSON.stringify({ to: email, createdAt: new Date(Date.now() - 60_000).toISOString(), otp: '111111' }),
    JSON.stringify({ to: email, createdAt: new Date().toISOString(), otp: '482731' }),
  ].join('\n'));
  const fetch = vi.fn(async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/api/auth/email-otp/send-verification-otp')) return new Response(null, { status: 200 });
    if (url.endsWith('/api/auth/sign-in/email-otp')) {
      expect(JSON.parse(init.body).otp).toBe('482731');
      return new Response(null, { status: 200, headers: { 'set-cookie': 'session=fixture; Path=/' } });
    }
    if (url.endsWith('/api/authentication/token')) return Response.json({ access_token: 'test-access-token' });
    throw new Error('unexpected request');
  });
  try {
    const credential = await acquireCredential('outbox-oauth', {
      base: 'http://localhost:3030',
      origin: 'http://localhost:3030',
      email,
      localOutbox: outbox,
      env: {},
      grant: 'http-email',
      fetch,
      sleep: async () => {},
    });
    expect(credential.token).toBe('test-access-token');
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('finds a matching login mail beyond the first ten concurrent unrelated arrivals', async () => {
  const since = Date.now() - 1_000;
  const unrelated = Array.from({ length: 100 }, (_, index) => ({
    id: `unrelated-${index + 1}`,
    to: [`other-${index + 1}@example.test`],
    created_at: new Date(since + 100).toISOString(),
  }));
  const matched = {
    id: 'matching-message',
    to: 'eval+case@example.test',
    created_at: new Date(since + 200).toISOString(),
  };
  const urls = [];
  const fetch = vi.fn(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/api/auth/email-otp/send-verification-otp')) return new Response(null, { status: 200 });
    if (url.startsWith(`${received}?`)) {
      const query = new URL(url).searchParams;
      expect(query.get('limit')).toBe('100');
      if (query.has('after')) {
        expect(query.get('after')).toBe('unrelated-100');
        return Response.json({ data: [matched], has_more: false });
      }
      return Response.json({ data: unrelated, has_more: true });
    }
    if (url === `${received}/matching-message`) return Response.json({ text: 'Your sign-in code is 731904' });
    if (url.endsWith('/api/auth/sign-in/email-otp')) return new Response(null, { status: 200, headers: { 'set-cookie': 'session=fixture; Path=/' } });
    if (url.endsWith('/api/authentication/token')) return Response.json({ access_token: 'test-access-token' });
    throw new Error('unexpected request');
  });

  const credential = await acquireCredential('inbox-oauth', {
    base: 'https://product.example.test',
    origin: 'https://product.example.test',
    email: 'eval+case@example.test',
    env: { EVAL_LOGIN_EMAIL: 'eval@example.test', RESEND_EVAL_API_KEY: 'test-inbox-key' },
    grant: 'http-email',
    fetch,
    sleep: async () => {},
  });

  expect(credential.token).toBe('test-access-token');
  expect(urls.some((url) => url.includes('after=unrelated-100'))).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('reports safe mailbox status counts on timeout without echoing response or credential data', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
  const privateSentinels = ['private-inbox-key-xyz', 'private-person@example.test', '731904', 'private-body-marker'];
  let listRequests = 0;
  const fetch = vi.fn(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/auth/email-otp/send-verification-otp')) return new Response(privateSentinels.join(' '), { status: 200 });
    if (url.startsWith(`${received}?`)) {
      listRequests++;
      if (listRequests === 1) throw new Error(privateSentinels.join(' '));
      return new Response(privateSentinels.join(' '), { status: 503 });
    }
    throw new Error('unexpected request');
  });

  const pending = acquireCredential('inbox-oauth', {
    base: 'https://product.example.test',
    email: 'private-person@example.test',
    env: { EVAL_LOGIN_EMAIL: 'private-person@example.test', RESEND_EVAL_API_KEY: 'private-inbox-key-xyz' },
    fetch,
    sleep: async (ms) => { await vi.advanceTimersByTimeAsync(ms); },
  });

  await expect(pending).rejects.toThrow(/mailbox diagnostics: polls=\d+, list_statuses=503=\d+, detail_statuses=none, pages=0, matching_messages=0, page_limit_reached=false, invalid_responses=0, request_errors=1/);
  const error = await pending.catch((value) => value);
  for (const sentinel of privateSentinels) expect(error.message).not.toContain(sentinel);
});

it('distinguishes an exhausted pagination cap from an empty mailbox page', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
  let listRequests = 0;
  const fetch = vi.fn(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/auth/email-otp/send-verification-otp')) return new Response(null, { status: 200 });
    if (url.startsWith(`${received}?`)) {
      listRequests++;
      const data = Array.from({ length: 100 }, (_, index) => ({
        id: `message-${listRequests}-${index}`,
        to: ['unrelated@example.test'],
        created_at: '2026-10-14T00:00:00.000Z',
      }));
      return Response.json({ data, has_more: true });
    }
    throw new Error('unexpected request');
  });
  const pending = acquireCredential('inbox-oauth', {
    base: 'https://product.example.test',
    email: 'eval@example.test',
    env: { EVAL_LOGIN_EMAIL: 'eval@example.test', RESEND_EVAL_API_KEY: 'test-inbox-key' },
    fetch,
    sleep: async (ms) => { await vi.advanceTimersByTimeAsync(ms); },
  });
  await expect(pending).rejects.toThrow(/pages=610, matching_messages=0, page_limit_reached=true/);

  vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
  const emptyFetch = vi.fn(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/auth/email-otp/send-verification-otp')) return new Response(null, { status: 200 });
    if (url.startsWith(`${received}?`)) return Response.json({ data: [], has_more: false });
    throw new Error('unexpected request');
  });
  const empty = acquireCredential('inbox-oauth', {
    base: 'https://product.example.test',
    email: 'eval@example.test',
    env: { EVAL_LOGIN_EMAIL: 'eval@example.test', RESEND_EVAL_API_KEY: 'test-inbox-key' },
    fetch: emptyFetch,
    sleep: async (ms) => { await vi.advanceTimersByTimeAsync(ms); },
  });
  await expect(empty).rejects.toThrow(/pages=61, matching_messages=0, page_limit_reached=false/);
});
