/**
 * WHICH document did the agent actually publish?
 *
 * The start link names one artifact, but an agent may ignore it and `POST
 * /api/artifacts` a new one — Claude Opus 5 did exactly that on the report
 * task, twice, and the scorer read the untouched start document and reported a
 * titleless failure for a document that was never written. The ledger knows the
 * truth: the id of the last artifact successfully written to.
 */
import { describe, it, expect } from 'vitest';
import { targetArtifactId } from '../lib/ledger';
import type { LedgerEntry } from '../lib/contracts';

const e = (over: Partial<LedgerEntry>): LedgerEntry => ({ t: 0, ms: 1, method: 'GET', path: '/x', status: 200, ua: null, auth: null, error: null, ...over });

describe('targetArtifactId', () => {
  it('is the start document when the agent edited it in place', () => {
    expect(targetArtifactId([e({ method: 'PUT', path: '/api/artifacts/abc123', status: 200, artifactId: 'abc123' })])).toBe('abc123');
  });

  it('follows the agent to an artifact it created itself', () => {
    const entries = [
      e({ method: 'GET', path: '/a/start1/start?k=x' }),
      e({ method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'newOne' }),
      e({ method: 'POST', path: '/api/artifacts/newOne/edits', status: 200, artifactId: 'newOne' }),
    ];
    expect(targetArtifactId(entries)).toBe('newOne');
  });

  it('takes the LAST successful write when the agent made several artifacts', () => {
    const entries = [
      e({ method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'first' }),
      e({ method: 'POST', path: '/api/artifacts', status: 201, artifactId: 'second' }),
      e({ method: 'POST', path: '/api/artifacts/first/edits', status: 200, artifactId: 'first' }),
    ];
    expect(targetArtifactId(entries)).toBe('first');
  });

  it('ignores failed writes and reads', () => {
    const entries = [
      e({ method: 'PUT', path: '/api/artifacts/good', status: 200, artifactId: 'good' }),
      e({ method: 'PUT', path: '/api/artifacts/bad', status: 400, artifactId: 'bad', error: 'invalid_jsx' }),
      e({ method: 'GET', path: '/api/artifacts/other', status: 200, artifactId: 'other' }),
    ];
    expect(targetArtifactId(entries)).toBe('good');
  });

  it('is null when nothing was ever written', () => {
    expect(targetArtifactId([e({ method: 'GET', path: '/docs/llm' })])).toBeNull();
  });

  it('follows an MCP write, whose artifact id is only in the response body', () => {
    expect(targetArtifactId([e({ method: 'POST', path: '/mcp', status: 200, artifactId: 'viaMcp' })])).toBe('viaMcp');
  });
});
