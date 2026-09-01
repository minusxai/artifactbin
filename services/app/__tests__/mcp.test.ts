/**
 * The MCP server — a protocol adapter over the same service
 * functions as the REST API, bearer-Token authed. Exercised in-process against
 * the route handler (JSON mode of the streamable HTTP transport).
 */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { POST as mcp } from '@/app/mcp/route';
import { PUBLIC_BASE_URL } from '@/lib/config';
import { mintToken, resolveToken } from '@/lib/tokens';
import { createAnnotationFor, type AnnotationWire } from '@/lib/annotations';

useAppHarness();

const rpc = (token: string | null, body: unknown) =>
  mcp(request('/mcp', { method: 'POST', ...(token ? { token } : {}), headers: { Accept: 'application/json, text/event-stream' }, json: body }));

const mcpCall = async (token: string, name: string, args: Record<string, unknown>) => {
  const res = await rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  return { isError: body.result.isError ?? false, data: JSON.parse(body.result.content[0].text) as Record<string, unknown> };
};

describe('MCP server', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } } });
    expect(res.status).toBe(401);
  });

  it('advertises instructions that point the agent at the llm docs', async () => {
    const t = await mintToken('t');
    const res = await rpc(t.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { instructions?: string } };
    expect(body.result.instructions).toContain(`${PUBLIC_BASE_URL}/docs/artifactbin/SKILL.md`);
    expect(body.result.instructions).toContain(`${PUBLIC_BASE_URL}/docs/artifactbin/references/markup.md`);
    expect(body.result.instructions).toContain(`${PUBLIC_BASE_URL}/docs/artifactbin/references/templates-<name>.md`);
    expect(body.result.instructions).toContain('themes-<name>.md');
    expect(body.result.instructions).toContain(`${PUBLIC_BASE_URL}/docs`);
  });

  it('remembers MCP clientInfo on the token for later stateless tool calls', async () => {
    const t = await mintToken('t');
    const res = await rpc(t.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.2.3' } } });
    expect(res.status).toBe(200);
    expect(await resolveToken(t.token)).toMatchObject({ clientHarness: 'claude-code' });

    const doc = await mcpCall(t.token, 'create_artifact', { markup: '<p>check this</p>' });
    const annotation = await createAnnotationFor(
      { tokenId: t.id, userId: null },
      doc.data.id as string,
      { bodyPath: '0', baseEditId: doc.data.edit_id as string, body: 'is this right?' },
      { kind: 'human', label: null, transport: 'browser' },
    ) as AnnotationWire;
    const replied = await mcpCall(t.token, 'annotate', {
      id: doc.data.id,
      annotation_id: annotation.id,
      reply: 'yes — verified',
    });
    const thread = replied.data.thread as AnnotationWire['thread'];
    expect(thread[1].author).toMatchObject({ kind: 'agent', label: 'Claude Code', transport: 'mcp' });
  });

  it('lists the artifact tools', async () => {
    const t = await mintToken('t');
    const res = await rpc(t.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const body = (await res.json()) as { result: { tools: Array<{ name: string; description?: string }> } };
    const names = body.result.tools.map((x) => x.name);
    for (const n of ['create_artifact', 'update_artifact', 'edit_artifact', 'get_artifact', 'annotate', 'list_artifacts', 'list_versions', 'get_version', 'revert_artifact', 'delete_artifact']) {
      expect(names).toContain(n);
    }
    const getDescription = body.result.tools.find((tool) => tool.name === 'get_artifact')?.description ?? '';
    expect(getDescription).toContain('data-annotation-anchor');
    expect(getDescription).toMatch(/preserve/i);
    expect(getDescription).toMatch(/never author or change/i);
  });

  it('create → get → update round-trips a markup artifact with refs, token-scoped', async () => {
    const t = await mintToken('t');
    const ds = await mcpCall(t.token, 'create_artifact', { title: 'sales', dataset: [{ m: 'Jan', v: 1 }, { m: 'Feb', v: 2 }] });
    expect(ds.isError).toBe(false);
    expect(ds.data.columns).toEqual([{ name: 'm', type: 'string' }, { name: 'v', type: 'number' }]);

    const story = await mcpCall(t.token, 'create_artifact', {
      title: 'story',
      markup: `<Helmet><Query name="rows">{\`select * from ref_${ds.data.id}\`}</Query></Helmet><div data-design="tw"><Question data="$rows" viz={{kind:"table"}} height="200px" /></div>`,
    });
    expect(story.isError).toBe(false);
    // One URL per artifact, addressed by the one identifier: /a/<id> is the
    // only link (editing is a mode on it), and there is no second name.
    expect(story.data.url).toBe(`${PUBLIC_BASE_URL}/a/${story.data.id}`);
    expect(story.data).not.toHaveProperty('slug');
    expect(story.data).not.toHaveProperty('editUrl');

    const got = await mcpCall(t.token, 'get_artifact', { id: story.data.id as string });
    expect(got.data.refs).toEqual([{ id: ds.data.id, kind: 'dataset' }]);

    const updated = await mcpCall(t.token, 'update_artifact', {
      id: story.data.id as string,
      markup: `<Helmet><Query name="rows">{\`select * from ref_${ds.data.id}\`}</Query></Helmet><div data-design="tw"><h1 className="text-2xl">v2</h1><Question data="$rows" viz={{kind:"table"}} height="200px" /></div>`,
      theme: 'terminal',
    });
    expect(updated.isError).toBe(false);
    expect(updated.data.version).toBe(2);

    // Another token cannot see it (uniform not-found).
    const other = await mintToken('other');
    const denied = await mcpCall(other.token, 'get_artifact', { id: story.data.id as string });
    expect(denied.isError).toBe(true);
  });

  it('a retired theme is a real tool result carrying the successor hint, not a schema error', async () => {
    const t = await mintToken('t');
    // The zod schema deliberately does NOT enum the theme: a retired name must
    // reach the publish pipeline, whose 400 names the successor — an agent's
    // only route out. A schema enum would answer with a generic zod error.
    const res = await mcpCall(t.token, 'create_artifact', { markup: '<p>x</p>', theme: 'nocturne' });
    expect(res.isError).toBe(true);
    expect(res.data.error).toBe('retired_theme');
    expect(String(res.data.hint)).toContain('modernist');
  });

  it('edit_artifact speaks the concurrent-edit protocol: accept, then doc_changed with head to rebase on', async () => {
    const t = await mintToken('t');
    const doc = await mcpCall(t.token, 'create_artifact', { title: 's', markup: '<section><p>alpha text</p><p>beta text</p></section>' });
    expect(doc.isError).toBe(false);
    expect(doc.data.edit_id).toMatch(/^[a-f0-9]{32}$/);

    const first = await mcpCall(t.token, 'edit_artifact', {
      id: doc.data.id, edit_id: doc.data.edit_id, old_string: 'alpha text', new_string: 'ALPHA',
    });
    expect(first.isError).toBe(false);
    expect(first.data.edit_id).not.toBe(doc.data.edit_id);

    const clash = await mcpCall(t.token, 'edit_artifact', {
      id: doc.data.id, edit_id: doc.data.edit_id, old_string: 'alpha', new_string: 'x',
    });
    expect(clash.isError).toBe(true);
    expect(clash.data.error).toBe('doc_changed');
    expect(clash.data.edit_id).toBe(first.data.edit_id);
    expect(clash.data.source).toContain('ALPHA');
  });

  it('surfaces validation diagnostics through tool errors', async () => {
    const t = await mintToken('t');
    const bad = await mcpCall(t.token, 'create_artifact', { title: 'x', markup: '<Bogus>nope</Bogus>' });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.data)).toContain('Bogus');
  });

  it('dataset refresh warns about broken dependents (never blocks)', async () => {
    const t = await mintToken('t');
    const ds = await mcpCall(t.token, 'create_artifact', { title: 'sales', dataset: [{ m: 'Jan', v: 1 }] });
    const story = await mcpCall(t.token, 'create_artifact', {
      title: 'story',
      markup: `<Helmet><Query name="rows">{\`select * from ref_${ds.data.id}\`}</Query></Helmet><div data-design="tw"><Question data="$rows" viz={{kind:"vega-lite", spec:{mark:"bar", encoding:{y:{field:"v", type:"quantitative"}}}}} height="200px" /></div>`,
    });
    const refreshed = await mcpCall(t.token, 'update_artifact', { id: ds.data.id as string, dataset: [{ m: 'Jan', other: 9 }] });
    expect(refreshed.isError).toBe(false);
    expect(JSON.stringify(refreshed.data.warnings)).toContain(story.data.id);
  });
});

describe('export_artifact — the tool an MCP-authed agent has instead of a bearer on the export URL', () => {
  it('answers a NATIVE image content block, or an honest render error — never a silent nothing', async () => {
    const t = await mintToken('t');
    const doc = await mcpCall(t.token, 'create_artifact', { title: 'shot', markup: '<h1 className="text-2xl">shot</h1>' });
    expect(doc.isError).toBe(false);
    const res = await rpc(t.token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'export_artifact', arguments: { id: doc.data.id } } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } };
    if (body.result.isError) {
      // The BYTES are proven in a browser gate; without one the refusal must
      // be named, exactly like the URL's (see export.test.ts).
      expect(JSON.parse(body.result.content[0].text!).error).toMatch(/render_(failed|unavailable)/);
    } else {
      expect(body.result.content[0].type).toBe('image');
      expect(body.result.content[0].mimeType).toBe('image/png');
      expect((body.result.content[0].data ?? '').length).toBeGreaterThan(100);
    }
  });

  it('an unreachable id is the uniform not_found, and a bad slide is named before any render', async () => {
    const t = await mintToken('t');
    const missing = await mcpCall(t.token, 'export_artifact', { id: 'zzzzz9' });
    expect(missing.isError).toBe(true);
    expect(missing.data.error).toBe('not_found');
  });
});

describe('MCP optimistic concurrency', () => {
  it('update_artifact with a stale expectedVersion reports version_conflict; replay converges', async () => {
    const t = await mintToken('agent');
    const created = await mcpCall(t.token, 'create_artifact', { markup: '<h1 className="text-2xl">v1</h1>' });
    expect(created.isError).toBe(false);
    const id = created.data.id as string;

    // A concurrent editor bumps the head (v1 → v2).
    const other = await mcpCall(t.token, 'update_artifact', { id, markup: '<h1 className="text-2xl">other</h1>' });
    expect(other.data.version).toBe(2);

    // This agent still holds v1 — the guarded update must conflict, not clobber.
    const stale = await mcpCall(t.token, 'update_artifact', { id, markup: '<h1 className="text-2xl">mine</h1>', expectedVersion: 1 });
    expect(stale.isError).toBe(true);
    expect(stale.data.error).toBe('version_conflict');
    expect(stale.data.currentVersion).toBe(2);

    // Replay at the reported head converges.
    const replay = await mcpCall(t.token, 'update_artifact', { id, markup: '<h1 className="text-2xl">mine</h1>', expectedVersion: 2 });
    expect(replay.isError).toBe(false);
    expect(replay.data.version).toBe(3);
  });
});

/**
 * WHO IS ASKING, in the split shape.
 *
 * `/mcp` resolved the bearer token itself, against the app's own database. That
 * is the proxy's table: with identity in its own schema and its own role, the
 * app cannot read it, so a caller with a perfectly good token was told
 * `unauthorized` — and the MCP gate failed on a stack where every other
 * authenticated route worked, because every other route reads the actor attached
 * by the in-process proxy.
 *
 * The attached actor IS the answer; this route was the last place still doing
 * its own authentication.
 */
describe('/mcp authorizes from the attached actor', () => {
  const signed = async (actor: import('@artifactbin/contracts').Actor, body: unknown) => {
    const { attachActor } = await import('@artifactbin/utils');
    return mcp(attachActor(new Request('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }), actor));
  };
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } };

  it('opens a session for a bearer actor, without reading the tokens table', async () => {
    const res = await signed({ credential: 'bearer', tokenId: 'tok_never_stored', userId: 'usr_abc' }, initialize);
    expect(res.status).toBe(200);
  });

  it('still refuses `none`, and still says how to get in', async () => {
    const res = await signed({ credential: 'none' }, initialize);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata');
  });
});
