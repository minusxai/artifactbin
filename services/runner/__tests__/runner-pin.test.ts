/** The pin a remote runner signs for the app carries the caller the app admitted the run for, from the admitted request only. */
import { describe, expect, it } from 'vitest';
import type { Actor, RunnerJson, RunStart, Upstream } from '@artifactbin/contracts';
import { remoteArtifactbin, runnerIdentity } from '../src/capabilities';

const request = (input: RunnerJson): RunStart => ({ requestId: 'q', userId: 'owner1', pageBackendOperation: 'query', artifactId: 'backend1', artifactVersion: 'v1', document: { source: 'bundle', editId: 'v1' }, program: { source: 'bundle', language: 'javascript' }, input });
const context = (input: RunnerJson) => ({ runId: 'run1', callId: 1, request: request(input), signal: new AbortController().signal, requests: [], usage: [] });

describe('runnerIdentity caller', () => {
  it('signs the admitted principal\'s subject and role', () => {
    expect(runnerIdentity(context({ kind: 'invoke', field: 'x', args: {}, principal: { tenant: 'page1', subject: 'viewer1', role: 'viewer' } })).runner?.caller).toEqual({ subject: 'viewer1', role: 'viewer' });
    expect(runnerIdentity(context({ kind: 'invoke', principal: { tenant: 'page1', subject: null, role: 'anonymous' } })).runner?.caller).toEqual({ subject: null, role: 'anonymous' });
  });
  it('signs no caller for a compile run, a principal without a known role, or a malformed one', () => {
    for (const input of [{ kind: 'schema' }, { kind: 'invoke', principal: { tenant: 'page1', subject: 'u' } }, { kind: 'invoke', principal: { tenant: 'page1', subject: 'u', role: 'admin' } }, { kind: 'invoke', principal: { tenant: 'page1', subject: 7, role: 'owner' } }, null] as RunnerJson[]) {
      const pin = runnerIdentity(context(input)).runner;
      expect(pin?.artifactId, JSON.stringify(input)).toBe('backend1');
      expect(pin && 'caller' in pin, JSON.stringify(input)).toBe(false);
    }
  });
  it('the remote callback forwards that pin with every capability call', async () => {
    const seen: Actor[] = [];
    const forward: Upstream = async (_request, actor) => { seen.push(actor!); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); };
    await remoteArtifactbin('https://app.internal', forward)(context({ kind: 'invoke', principal: { tenant: 'page1', subject: 'viewer1', role: 'viewer' } }), 'artifactbin.pageBackend.query', { query: '{ x }', principal: { subject: 'owner1', role: 'owner' } });
    expect(seen[0]?.runner?.caller).toEqual({ subject: 'viewer1', role: 'viewer' });
  });
});

describe('runnerIdentity admission', () => {
  const admission = { page: 'page1', head: 'a'.repeat(64), function: 'refresh', claim: { link: 'api', token: 't1', epoch: 2 } };
  it('signs the admission the app put in the run input, and none that is malformed or absent', () => {
    expect(runnerIdentity(context({ kind: 'invoke', field: 'refresh', principal: { tenant: 'page1', subject: 'u', role: 'owner' }, admission })).runner?.admission).toEqual(admission);
    for (const input of [{ kind: 'invoke', principal: { tenant: 'page1', subject: 'u', role: 'owner' } }, { kind: 'invoke', principal: { tenant: 'page1', subject: 'u', role: 'owner' }, admission: { ...admission, head: 'x' } }] as RunnerJson[])
      expect('admission' in (runnerIdentity(context(input)).runner ?? {}), JSON.stringify(input)).toBe(false);
  });
});
