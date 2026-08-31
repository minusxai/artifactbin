/**
 * A dataset from any public CSV URL. The load-bearing refusal is the html
 * sniff: a login page or a 404 body stored verbatim as a "dataset" is the
 * silent failure this door exists to prevent — the same lesson the Sheets
 * integration learned, generalized off its one pinned host.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchCsvFromUrl } from '../csv-url';
import { IngestError } from '../types';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { withHttpServer, type RunningServer } from '@/__tests__/net';

const CSV = 'region,units\nnorth,42\n';

let server: RunningServer;
let base: string;

beforeAll(async () => {
  server = await withHttpServer((req, res) => {
    switch (req.url) {
      case '/rows.csv':
        res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(CSV); return;
      case '/rows-octet':
        // Real CSV hosting routinely mislabels: the TEXT decides, not the header.
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(CSV); return;
      case '/rows-bom':
        res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end('﻿' + CSV); return;
      case '/login':
        // 200 + html: a private file behind a sign-in wall. The status is
        // useless here; only the body says what happened.
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><body>Sign in</body></html>'); return;
      case '/login-no-doctype':
        res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end('  \n<html><body>nope</body></html>'); return;
      case '/gone':
        res.writeHead(404); res.end(); return;
      default:
        res.writeHead(500); res.end();
    }
  });
  base = server.base;
  setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

afterEach(() => setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true }));

const code = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return 'NO_ERROR'; } catch (e) { return e instanceof IngestError ? e.code : `OTHER:${e}`; }
};

describe('fetchCsvFromUrl', () => {
  it('returns the text for a CSV, whatever the content type claims', async () => {
    expect(await fetchCsvFromUrl(`${base}/rows.csv`)).toBe(CSV);
    expect(await fetchCsvFromUrl(`${base}/rows-octet`)).toBe(CSV);
  });

  it('passes a BOM through — the parser owns stripping it, not the fetcher', async () => {
    expect(await fetchCsvFromUrl(`${base}/rows-bom`)).toContain('region,units');
  });

  it('refuses html served as 200 — a sign-in page is not a dataset', async () => {
    expect(await code(fetchCsvFromUrl(`${base}/login`))).toBe('csv_fetch_failed');
    // …including one with no doctype and leading whitespace.
    expect(await code(fetchCsvFromUrl(`${base}/login-no-doctype`))).toBe('csv_fetch_failed');
  });

  it('names the URL in the refusal, so the caller can see which link failed', async () => {
    try {
      await fetchCsvFromUrl(`${base}/login`);
      throw new Error('should refuse');
    } catch (e) {
      expect((e as IngestError).message).toContain('/login');
      expect((e as IngestError).message).toMatch(/html/i);
    }
  });

  it('maps a transport refusal onto the ingest vocabulary', async () => {
    expect(await code(fetchCsvFromUrl(`${base}/gone`))).toBe('csv_fetch_failed');
  });

  it('refuses a forbidden target through the shared guard', async () => {
    setWebIngestPolicyForTests(null); // production policy
    expect(await code(fetchCsvFromUrl('https://169.254.169.254/latest/meta-data'))).toBe('csv_fetch_failed');
  });
});
