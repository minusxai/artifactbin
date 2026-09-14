import type { ServerResponse } from 'node:http';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';
import { scrubSecrets } from '../secrets';

/** The trial relay may address only its driver-owned app, never a request-selected host. */
export function trialUpstreamUrl(target: string): URL {
  if (!target.startsWith('/') || target.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(target)) {
    throw new Error('Expected an origin-relative request target');
  }
  const url = new URL(target, 'http://127.0.0.1:3391');
  if (url.origin !== 'http://127.0.0.1:3391' || url.username || url.password) {
    throw new Error('Trial upstream origin cannot change');
  }
  return url;
}

/** IDs from HTTP responses are data, including when embedded in a harness prompt. */
export function trialArtifactId(value: unknown): string {
  if (typeof value !== 'string' || !ARTIFACT_ID_PATTERN.test(value)) throw new Error('Invalid published artifact ID');
  return value;
}

export function writeTrialError(res: ServerResponse, error: unknown, secrets: string[]): void {
  res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end(scrubSecrets(error instanceof Error ? error.message : String(error), secrets));
}
