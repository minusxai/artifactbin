/**
 * The operations registry — ONE curated list of what an agent can do, from
 * which the HTTP artifact routes are rendered. These are the rules that keep
 * it a registry
 * rather than a dump of routes (the pitfall of generating a tool surface from
 * an API spec): model-facing descriptions, one worked example per operation
 * that actually parses, read/write/destructive annotated, and an error
 * vocabulary with a fix per code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { BrowserSessionRequest, BrowserSessionResult } from '@artifactbin/contracts';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { services, setServices } from '@/lib/services';

describe('the registry is curated, not generated', () => {
  it('teaches atomic batches and persistent ids in the model-facing descriptions',()=>{
    const edit=OPERATIONS.find(op=>op.name==='edit_artifact')!.description;
    expect(edit).toMatch(/edits.*64/);
    expect(edit).toMatch(/final.*validat/i);
    expect(edit).toMatch(/preserve.*ids/i);
    const read=OPERATIONS.find(op=>op.name==='get_artifact')!.description;
    expect(read).toContain('anchor.nodeId');
    expect(read).toMatch(/relations.*never.*source/i);
  });
  it('names are unique snake_case verbs', () => {
    const names = OPERATIONS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('carries the artifact and dataset operations of the protocol', () => {
    expect(OPERATIONS.map((o) => o.name).sort()).toEqual([
      'annotate', 'browser_session', 'create_artifact', 'create_dataset_secret', 'delete_artifact', 'discover_dataset_source', 'edit_artifact', 'export_artifact', 'fork_artifact', 'get_artifact',
      'get_dataset_policy', 'get_remote_session', 'get_version', 'list_artifacts', 'list_remote_sessions', 'list_versions', 'mutate_dataset', 'preview_dataset_notebook', 'query_resource', 'refresh_asset', 'restore_artifact', 'revert_artifact',
      'set_dataset_policy', 'terminate_remote_session', 'testuser_create', 'testuser_delete', 'testuser_list', 'update_artifact', 'update_metadata',
    ]);
  });

  it('every example input parses against the operation\'s own schema', () => {
    for (const op of OPERATIONS) {
      expect(() => z.object(op.input).parse(op.example.input), op.name).not.toThrow();
    }
  });

  it('every description is one model-facing paragraph — present, bounded, saying what comes back', () => {
    for (const op of OPERATIONS) {
      expect(op.description.length, op.name).toBeGreaterThan(40);
      // Context on every agent turn: the description must stay a paragraph, not a page.
      expect(op.description.length, op.name).toBeLessThanOrEqual(1200);
      expect(op.title, op.name).toBeTruthy();
    }
  });

  it('read/write/destructive is annotated, and the reads are the reads', () => {
    const readOnly = OPERATIONS.filter((o) => o.annotations.readOnly).map((o) => o.name).sort();
    expect(readOnly).toEqual(['discover_dataset_source', 'export_artifact', 'get_artifact', 'get_dataset_policy', 'get_remote_session', 'get_version', 'list_artifacts', 'list_remote_sessions', 'list_versions', 'preview_dataset_notebook', 'query_resource', 'testuser_list']);
    expect(OPERATIONS.find((o) => o.name === 'delete_artifact')!.annotations.destructive).toBe(true);
  });

  it('every operation names its HTTP address, and its path params are input fields', () => {
    for (const op of OPERATIONS) {
      // /api/artifacts is the bearer surface; export is the one op whose HTTP
      // twin is the document's own sub-path (a page can't return bytes); and
      // /api/testusers is the throwaway-people family, which is about the
      // CALLER rather than about any one artifact.
      expect(op.http.path, op.name).toMatch(/^\/api\/(artifacts|datasets|secrets|sessions|browser-sessions|testusers)(\/|$)|^\/a\/\{id\}\/export$/);
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(op.http.method);
      for (const [, param] of op.http.path.matchAll(/\{(\w+)\}/g)) {
        expect(Object.keys(op.input), `${op.name}: path param ${param}`).toContain(param);
      }
    }
  });

  it('the read-only dataset fix names the command that publishes one writable', () => {
    const mutate = OPERATIONS.find((op) => op.name === 'mutate_dataset')!;
    const refusal = mutate.errors.find((e) => e.code === 'dataset_read_only')!;
    expect(refusal.fix).toContain('--type dataset --access readwrite');
  });
  it('the error vocabulary has a fix per code, no code twice within an operation', () => {
    for (const op of OPERATIONS) {
      const codes = op.errors.map((e) => e.code);
      expect(new Set(codes).size, op.name).toBe(codes.length);
      for (const e of op.errors) {
        expect(e.fix, `${op.name}/${e.code}`).toBeTruthy();
        expect(e.status, `${op.name}/${e.code}`).toBeGreaterThanOrEqual(400);
      }
    }
  });
});

/** Who a session BROWSES as is the caller's decision, made once, on the request that creates it. */
describe('browser_session viewer', () => {
  const operation = OPERATIONS.find((op) => op.name === 'browser_session')!;
  const script = { op: 'script', session_id: 'session-id', execution_id: 'execution-id', create: true, code: 'return 1' };
  const context = { actor: { tokenId: 'tok_owner', userId: 'usr_owner' }, base: 'http://app', request: new Request('http://app/api/browser-sessions', { method: 'POST' }), author: {} } as unknown as OpContext;
  const previous = services().browser;
  const record = () => {
    // `viewer` and `pageActor` ride on the union's `script` member, so the
    // recorder reads a request as one shape rather than making every assertion
    // below narrow the op first.
    const seen: BrowserSessionRequest[] = [];
    setServices({ browser: { ...previous, sessions: {
      async request(input: BrowserSessionRequest): Promise<BrowserSessionResult> { seen.push(input); return { session_id: input.session_id, status: 'queued', pages: [], attachments: [] }; },
      async close() {},
    } } });
    return seen;
  };
  afterEach(() => setServices({ browser: previous }));

  it('accepts guest and test-user, and parses a script without a viewer', () => {
    const input = z.object(operation.input);
    expect(input.safeParse({ ...script, viewer: 'guest' }).success).toBe(true);
    expect(input.safeParse(script).success).toBe(true);
    for (const viewer of ['owner', 'anonymous', 'GUEST', '', true]) expect(input.safeParse({ ...script, viewer }).success, String(viewer)).toBe(false);
  });

  it('passes the viewer to the session service and sends none when the caller named none', async () => {
    const seen = record();
    await operation.run(context, { ...script, viewer: 'guest' });
    await operation.run(context, script);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ viewer: 'guest', actor: { credential: 'bearer', userId: 'usr_owner' } });
    expect(seen[1]).not.toHaveProperty('viewer');
    // A guest session still belongs to the caller who created it.
    expect(seen[0]!.actor).toMatchObject({ tokenId: 'tok_owner', userId: 'usr_owner' });
  });

  it('mints a throwaway second person for a test-user session and never hands its secret back', async () => {
    const seen = record();
    const result = await operation.run(context, { ...script, viewer: 'test-user' });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ viewer: 'test-user', actor: { tokenId: 'tok_owner', userId: 'usr_owner' } });
    const page = seen[0]!.pageActor!;
    expect(page.credential).toBe('bearer');
    expect(page.userId).toMatch(/^usr_/);
    expect(page.userId).not.toBe('usr_owner');
    expect(page.tokenId).toMatch(/^tok_|^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(result.body)).not.toContain(page.tokenId!);
  });

  // runOperation hands the body to run() unparsed, so the refusal has to live in the operation itself.
  it('refuses a viewer it cannot browse as, without reaching the session service', async () => {
    const seen = record();
    for (const viewer of ['owner', 'anonymous', 'GUEST', true]) {
      const reply = await operation.run(context, { ...script, viewer });
      expect(reply.status, String(viewer)).toBe(400);
      expect(String(reply.body.error), String(viewer)).toBe('invalid_viewer');
    }
    expect(seen).toHaveLength(0);
  });

  it('tells an agent, in its description, how to see what a signed-out reader sees', () => {
    expect(operation.description).toMatch(/guest/i);
  });
});
