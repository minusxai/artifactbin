import {observedRequest} from '@/__tests__/conditional-request';
/**
 * The `jsx` content tier — the minusx stories engine.
 * Publish path: static JSX over the ported shadcn kit, validated by
 * validateJsxSource and compiled by Tailwind at publish (CSS is unconstrained:
 * no banned-CSS sanitize step). Source is the single truth; the viewer renders it live
 * at /a/<id> — the one URL an artifact has, no redirect and no second route.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { publishJsx } from '@/lib/story/document/jsx-tier';
import { mintToken } from '@/lib/accounts';

useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const JSX_DOC = `<div data-design="tw" className="@container w-full p-8" id="root">
  <h1 className="text-4xl font-bold" id="heading">Quarterly Revenue</h1>
  <Card className="mt-6" id="card"><CardHeader id="card-head"><CardTitle id="card-title">MRR</CardTitle></CardHeader>
    <CardContent id="card-body"><p className="text-2xl" id="mrr">$1.2M</p></CardContent></Card>
</div>`;

describe('jsx tier publish', () => {
  it('publishes and reads back the plan template', async () => {
    const t = await mintToken('plan-template');
    const res = await createArtifactRoute(request('/api/artifacts', {
      method: 'POST', token: t.token,
      json: { title: 'Scheduling UI plan', markup: JSX_DOC, template: 'plan' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    const got = await getArtifactRoute(request(`/api/artifacts/${body.id}`, { token: t.token }), params({ id: body.id }));
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({ template: 'plan', markup: JSX_DOC });
  });

  it('stores source + compiled CSS, with theme/colorMode in meta', async () => {
    const t = await mintToken('t');
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'Q3', markup: JSX_DOC, theme: 'terminal', template: 'editorial', colorMode: 'dark' } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe('markup');

    const got = await getArtifactRoute(request(`/api/artifacts/${body.id}`, { token: t.token }), params({ id: body.id }));
    const row = await got.json();
    expect(row.markup).toBe(JSX_DOC);
    expect(row.format).toBe('markup');
    expect(row.theme).toBe('terminal');
    expect(row.template).toBe('editorial');
    expect(row.colorMode).toBe('dark');
  });

  it('compiles the sheet at publish: source classes + token layer + all six themes', async () => {
    const stored = await publishJsx({}, JSX_DOC);
    expect(stored).not.toBeInstanceOf(Response);
    const meta = (stored as { meta: Record<string, unknown> }).meta;
    const css = meta.compiledCss as string;
    // A class the source uses, the token layer, and ALL six theme blocks
    // (theme switching is an attribute flip, no recompile).
    expect(css).toContain('.text-4xl');
    expect(css).toContain('--background');
    for (const theme of ['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop']) {
      expect(css).toContain(`[data-theme="${theme}"]`);
    }
    expect(typeof meta.cssCompileVersion).toBe('string');
  });

  it('rejects invalid jsx with actionable diagnostics (the validation gate)', async () => {
    const t = await mintToken('t');
    // Every vector this tier claims to stop. `markup` is interpreted as DATA
    // and rendered SAME-ORIGIN with the app (unlike the sandboxed html tier),
    // so a hole here reaches the UI's own origin — these are the assertions
    // that make "never executed" a checked claim rather than a comment.
    const cases: Array<[string, RegExp]> = [
      // handlers and script
      ['<div onClick={x}>no handlers</div>', /onClick|handler|not allowed/i],
      ['<div onClick="alert(1)">literal handler</div>', /onClick|handler|not allowed/i],
      ['<img src="ref:x" onError="alert(1)" />', /onError|handler|not allowed/i],
      ['<script>alert(1)</script>', /script/i],
      // unknown / disallowed tags
      ['<Bogus>unknown component</Bogus>', /Bogus/],
      ['<iframe src="https://evil.test"></iframe>', /iframe/i],
      ['<object data="evil.swf"></object>', /object/i],
      ['<form action="https://evil.test"><button>go</button></form>', /form/i],
      // html injection
      ['<div dangerouslySetInnerHTML={{__html:"<img src=x onerror=alert(1)>"}} />', /dangerouslySetInnerHTML|not allowed/i],
      ['<div {...props}>spread</div>', /JSON literal|Spread/i],
      // URL schemes (the ported gate; external hosts are a separate test)
      ['<a href="javascript:alert(1)">x</a>', /URL scheme/i],
      ['<a href="data:text/html,<h1>x</h1>">x</a>', /URL scheme/i],
      // non-literal values: anything the interpreter would have to EVALUATE
      ['<div>{globalThis.document.cookie}</div>', /Expression child|JSON literal/i],
      ['<div>{`${globalThis.x}`}</div>', /Expression child|JSON literal/i],
    ];
    for (const [markup, msg] of cases) {
      const res = await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup } }),
      );
      expect(res.status, markup).toBe(400);
      const body = await res.json();
      expect(body.error, markup).toBe('invalid_jsx');
      expect(JSON.stringify(body.details), markup).toMatch(msg);
    }
  });

  /**
   * External subresources are allowed: CSS and markup are unconstrained, and the
   * page CSP admits every https host. A web URL is kept as written in every
   * position, `<img src="https://…">` included — nothing is imported.
   */
  it('publishes external subresource URLs as written; inline style is valid', async () => {
    const t = await mintToken('t');
    // Each case and the attribute that must reach the stored source verbatim (publish only adds node ids).
    const cases: Array<[string, string]> = [
      ['<div data-design="tw"><img src="//cdn.test/p.png" /></div>', 'src="//cdn.test/p.png"'],
      ['<div data-design="tw"><img srcSet="https://cdn.test/a.png 1x, https://cdn.test/b.png 2x" /></div>', 'srcSet="https://cdn.test/a.png 1x, https://cdn.test/b.png 2x"'],
      ['<div data-design="tw"><video poster="https://cdn.test/p.jpg" /></div>', 'poster="https://cdn.test/p.jpg"'],
      ['<div data-design="tw"><a href="#x" ping="https://cdn.test/track">x</a></div>', 'ping="https://cdn.test/track"'],
      ['<div data-design="tw"><a href="#x" ping="ref:abc123 https://cdn.test/track">x</a></div>', 'ping="ref:abc123 https://cdn.test/track"'],
      ['<div data-design="tw"><div style="color:red">inline style</div></div>', 'style="color:red"'],
    ];
    for (const [markup, kept] of cases) {
      const res = await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup } }),
      );
      const body = await res.json();
      expect(res.status, `${markup} ${JSON.stringify(body)}`).toBe(201);
      const got = await getArtifactRoute(request(`/api/artifacts/${body.id}`, { token: t.token }), params({ id: body.id }));
      expect((await got.json()).markup, markup).toContain(kept);
    }

    // An unreachable host publishes as written with nothing to report: publish never fetches it.
    const unreachable = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup: '<div data-design="tw"><img src="https://evil.test/p.png" /></div>' } }),
    );
    expect(unreachable.status).toBe(201);
    const unreachableBody = await unreachable.json();
    expect(unreachableBody).not.toHaveProperty('asset_warnings');
    const stored = await getArtifactRoute(request(`/api/artifacts/${unreachableBody.id}`, { token: t.token }), params({ id: unreachableBody.id }));
    expect((await stored.json()).markup).toContain('src="https://evil.test/p.png"');
  });

  it('allows the self-contained sources: ref: and inline data:image', async () => {
    const t = await mintToken('t');
    const img = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'i', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } }),
    );
    const { id } = await img.json();
    const cases = [
      `<div data-design="tw"><img src="ref:${id}" /></div>`,
      '<div data-design="tw"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" /></div>',
      // href is NAVIGATION, not a subresource fetch — external links stay fine.
      '<div data-design="tw"><a href="https://example.com">read more</a></div>',
    ];
    for (const markup of cases) {
      const res = await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup } }),
      );
      expect(res.status, markup).toBe(201);
    }
  });

  it('rejects unknown theme/template/colorMode', async () => {
    const t = await mintToken('t');
    for (const bad of [{ theme: 'neon' }, { template: 'poster' }, { colorMode: 'sepia' }]) {
      const res = await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup: JSX_DOC, ...bad } }),
      );
      expect(res.status).toBe(400);
    }
  });

  it('is exactly-one-of with the other tiers', async () => {
    const t = await mintToken('t');
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup: JSX_DOC, markdown: '# hi' } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('markup_only');
  });

  it('PUT full-replace re-runs the pipeline and archives the old version', async () => {
    const t = await mintToken('t');
    const created = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'v1', markup: JSX_DOC, theme: 'modernist' } }),
      )
    ).json();

    const res = await putArtifact(
      await observedRequest(`/api/artifacts/${created.id}`, { method: 'PUT', token: t.token, json: { title: 'v2', markup: JSX_DOC.replace('Quarterly Revenue', 'Annual Revenue'), theme: 'pop' } }),
      params({ id: created.id }),
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.version).toBe(2);

    const got = await (await getArtifactRoute(request(`/api/artifacts/${created.id}`, { token: t.token }), params({ id: created.id }))).json();
    expect(got.markup).toContain('Annual Revenue');
    expect(got.theme).toBe('pop');
  });
});

describe('jsx tier serving', () => {
  it('GET /a/<id>/raw serves the engine tier as the SSR document', async () => {
    const t = await mintToken('t');
    const created = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'v', markup: JSX_DOC } }),
      )
    ).json();
    const res = await serveArtifact(request(`/a/${created.id}/raw`), params({ id: created.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('Quarterly Revenue');
  });
});
