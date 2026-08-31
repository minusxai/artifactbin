/**
 * A dataset from ANY public CSV URL — the Sheets integration generalized.
 * Same shape (URL in, text out, `ingestDataset` owns parsing and caps), but
 * the open web instead of one pinned host, so the fetch goes through
 * lib/web-ingest's full SSRF guard rather than a host regex.
 *
 * The content-type check is looser than Sheets' on purpose: Sheets always
 * labels its export text/csv, while real-world CSV hosting (S3 buckets, raw
 * GitHub, data portals) routinely answers text/plain or octet-stream. The
 * load-bearing refusal is the html sniff — a login page or a 404 body stored
 * verbatim as a "dataset" is the silent failure this door must never take.
 */
import { fetchWebResource } from '@/lib/web-ingest/fetch';
import { WebIngestError } from '@/lib/web-ingest/guard';
import { IngestError, MAX_DATASET_BYTES } from './types';

export async function fetchCsvFromUrl(url: string): Promise<string> {
  let text: string;
  try {
    const got = await fetchWebResource(url, { maxBytes: MAX_DATASET_BYTES, accept: 'text/csv, text/plain;q=0.9, */*;q=0.1' });
    text = got.bytes.toString('utf8');
  } catch (error) {
    if (error instanceof WebIngestError) {
      throw new IngestError('csv_fetch_failed', `${url}: ${error.message}`);
    }
    throw error;
  }
  const head = text.replace(/^﻿/, '').trimStart().slice(0, 256).toLowerCase();
  if (head.startsWith('<')) {
    throw new IngestError('csv_fetch_failed', `${url}: the response looks like html, not CSV — is the file public?`);
  }
  return text;
}
