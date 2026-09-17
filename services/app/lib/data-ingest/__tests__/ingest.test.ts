/**
 * Public Sheets ingest, and the caps.
 *
 * The failure shape here was measured, not guessed (data-artifacts-v2.md §2,
 * de-risk 7): a sheet that is not public answers `404` with `text/html` — no
 * redirect, no hang. So the guard is a content-type check, and the thing it
 * prevents is storing a Google login page as somebody's dataset.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sheetCsvUrl, fetchSheetCsv } from '../sheets';
import { ingestDataset } from '../index';
import { IngestError, MAX_DATASET_BYTES } from '../types';
import { MAX_ROWS_LIMIT } from '@/lib/config';

const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (body: string, init: { status?: number; type?: string } = {}) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': init.type ?? 'text/csv' },
  })) as unknown as typeof fetch);

describe('sheetCsvUrl', () => {
  it('turns an ordinary edit link into a CSV export, preserving the gid', () => {
    const url = sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=7`);
    expect(url).toContain(`/spreadsheets/d/${SHEET_ID}/export`);
    expect(url).toContain('format=csv');
    expect(url).toContain('gid=7'); // the wrong tab is a silently wrong dataset
  });

  it('defaults to the first tab when no gid is given', () => {
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`)).toContain('gid=0');
  });

  it('finds the gid in a query string as well as a fragment', () => {
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=42`)).toContain('gid=42');
  });

  it('passes an export URL through unchanged in effect', () => {
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=3`)).toContain('gid=3');
  });

  it('refuses anything that is not a Sheets link', () => {
    expect(sheetCsvUrl('https://example.com/data.csv')).toBeNull();
    expect(sheetCsvUrl('https://docs.google.com/document/d/abc/edit')).toBeNull();
    expect(sheetCsvUrl('not a url')).toBeNull();
  });
});

describe('fetchSheetCsv', () => {
  it('returns the CSV for a public sheet', async () => {
    stubFetch('a,b\n1,2');
    await expect(fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`)).resolves.toBe('a,b\n1,2');
  });

  it('rejects a non-public sheet instead of storing the HTML it returns', async () => {
    stubFetch('<!DOCTYPE html><html>…', { status: 404, type: 'text/html; charset=utf-8' });
    await expect(fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`))
      .rejects.toMatchObject({ code: 'sheet_not_public' });
  });

  it('rejects a 200 that is HTML — the login-page shape', async () => {
    // Belt for the case we could not reproduce from here: a private sheet that
    // answers 200 with a sign-in page rather than 404.
    stubFetch('<!DOCTYPE html><html>sign in', { status: 200, type: 'text/html' });
    await expect(fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`))
      .rejects.toMatchObject({ code: 'sheet_not_public' });
  });

  /**
   * GOOGLE REFUSING US IS NOT THE AUTHOR'S SHARING SETTINGS.
   *
   * The content-type guard treated every non-CSV answer alike, so a 429 or a
   * 5xx came back as "that sheet is not publicly readable" — sending someone
   * to fix a share setting that was never wrong. Found when CI's `data-ingest`
   * gate went red twice against Google's own public sample sheet
   * (run 33874008704): the sheet was fine, the runner was refused.
   *
   * A 403 stays `sheet_not_public`: that is what a genuinely private sheet
   * answers, and it is the common case by a distance.
   */
  it.each([429, 500, 503])('reports a %i from Google as fetch_failed, not the author\'s fault', async (status) => {
    stubFetch('<!DOCTYPE html><html>rate limited', { status, type: 'text/html' });
    await expect(fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`))
      .rejects.toMatchObject({ code: 'fetch_failed' });
  });

  it('names the status, so the reason is actionable', async () => {
    stubFetch('nope', { status: 429, type: 'text/html' });
    await expect(fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`))
      .rejects.toThrow(/429/);
  });

  it('still blames sharing for a 403, which is what a private sheet answers', async () => {
    stubFetch('<!DOCTYPE html><html>', { status: 403, type: 'text/html' });
    await expect(fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`))
      .rejects.toMatchObject({ code: 'sheet_not_public' });
  });

  it('refuses a non-Sheets URL before making any request', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    await expect(fetchSheetCsv('https://evil.example.com/x')).rejects.toMatchObject({ code: 'not_a_sheet_url' });
    expect(spy).not.toHaveBeenCalled(); // never fetch an arbitrary URL on a user's behalf
  });

  it('surfaces a network failure as fetch_failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch);
    await expect(fetchSheetCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`))
      .rejects.toMatchObject({ code: 'fetch_failed' });
  });
});

describe('ingestDataset', () => {
  it('ingests CSV text into rows publishDataset accepts', async () => {
    const r = await ingestDataset({ kind: 'csv', text: 'month,revenue\n2026-01,120\n2026-02,150' });
    expect(r.rows).toEqual([{ month: '2026-01', revenue: 120 }, { month: '2026-02', revenue: 150 }]);
    expect(r.rowCount).toBe(2);
    expect(r.headers).toEqual(['month', 'revenue']);
  });

  it('ingests a public sheet', async () => {
    stubFetch('a,b\n1,2');
    const r = await ingestDataset({ kind: 'sheetUrl', url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit` });
    expect(r.rows).toEqual([{ a: 1, b: 2 }]);
  });

  it('rejects empty content and a header-only file', async () => {
    await expect(ingestDataset({ kind: 'csv', text: '' })).rejects.toMatchObject({ code: 'empty' });
    await expect(ingestDataset({ kind: 'csv', text: '   ' })).rejects.toMatchObject({ code: 'empty' });
    // Headers but no data rows: publishDataset requires a non-empty array.
    await expect(ingestDataset({ kind: 'csv', text: 'a,b' })).rejects.toMatchObject({ code: 'empty' });
  });

  it('keeps the first MAX_ROWS_LIMIT rows and reports the true total', async () => {
    const text = ['n', ...Array(MAX_ROWS_LIMIT + 250).fill('1')].join('\n');
    const r = await ingestDataset({ kind: 'csv', text });
    expect(r.rows).toHaveLength(MAX_ROWS_LIMIT);
    expect(r.rowCount).toBe(MAX_ROWS_LIMIT);
    expect(r.totalRows).toBe(MAX_ROWS_LIMIT + 250);
    expect(r.truncated).toBe(true);
  });

  it('does not flag a dataset inside the limit as truncated', async () => {
    const r = await ingestDataset({ kind: 'csv', text: 'n\n1\n2' });
    expect(r.truncated).toBe(false);
    expect(r.totalRows).toBe(2);
  });

  it('rejects past the byte cap, naming the limit', async () => {
    const text = 'a\n' + 'x'.repeat(MAX_DATASET_BYTES + 1024);
    const err = await ingestDataset({ kind: 'csv', text }).catch((e) => e as IngestError);
    expect(err).toMatchObject({ code: 'too_large' });
    expect((err as IngestError).message).toMatch(/\d/); // the user must learn the limit
  });
});
