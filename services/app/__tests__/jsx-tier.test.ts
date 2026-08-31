/**
 * The `jsx` content tier — the minusx stories engine.
 * Publish path: static JSX over the ported shadcn kit, validated by the ported
 * three-gate pipeline (validateJsxSource → banned-css sanitize → Tailwind
 * compile at publish). Source is the single truth; the viewer renders it live
 * at /a/<id> — the one URL an artifact has, no redirect and no second route.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { publishJsx } from '@/lib/story/jsx-tier';
import { mintToken } from '@/lib/tokens';

const BASE = 'http://localhost:3000';
useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const JSX_DOC = `<div data-design="tw" className="@container w-full p-8">
  <h1 className="text-4xl font-bold">Quarterly Revenue</h1>
  <Card className="mt-6"><CardHeader><CardTitle>MRR</CardTitle></CardHeader>
    <CardContent><p className="text-2xl">$1.2M</p></CardContent></Card>
</div>`;

describe('jsx tier publish', () => {
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

  it('rejects invalid jsx with actionable diagnostics (the three-gate pipeline)', async () => {
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
      // styling escape hatches
      ['<div style="color:red">no inline style</div>', /style/i],
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
   * artifact-bin is stricter than the ported minusx validator on purpose: an
   * artifact must be SELF-CONTAINED. An external subresource makes a shared
   * document phone home with every viewer's IP, breaks when that host dies,
   * and — because ?export=png renders the page in our own headless browser —
   * turns the export endpoint into a server-side fetch of an attacker's URL.
   */
  it('rejects external subresource URLs, naming the ref: fix', async () => {
    const t = await mintToken('t');
    // NON-image positions stay hard refusals — a srcset, a ping tracker, a
    // protocol-relative URL and a lowercase <video poster> are not imports.
    // (An <img src="https://…"> is no longer here: that position is now
    // IMPORTED by the publish door — __tests__/web-import.test.ts owns it.)
    const cases: string[] = [
      '<div data-design="tw"><img src="//evil.test/p.png" /></div>',
      '<div data-design="tw"><img srcSet="https://evil.test/a.png 1x, https://evil.test/b.png 2x" /></div>',
      '<div data-design="tw"><video poster="https://evil.test/p.jpg" /></div>',
      '<div data-design="tw"><a href="#x" ping="https://evil.test/track">x</a></div>',
    ];
    for (const markup of cases) {
      const res = await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup } }),
      );
      expect(res.status, markup).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_jsx');
      // The diagnostic must teach the fix, not just refuse.
      expect(JSON.stringify(body.details), markup).toMatch(/ref:/);
    }

    // The imported position still refuses an unreachable host — but as a FETCH
    // refusal naming the URL, which is the actionable half of the new door.
    const imported = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'x', markup: '<div data-design="tw"><img src="https://evil.test/p.png" /></div>' } }),
    );
    expect(imported.status).toBe(400);
    const importedBody = await imported.json();
    expect(importedBody.error).toBe('image_fetch_failed');
    expect(String(importedBody.details)).toContain('evil.test');
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
      request(`/api/artifacts/${created.id}`, { method: 'PUT', token: t.token, json: { title: 'v2', markup: JSX_DOC.replace('Quarterly Revenue', 'Annual Revenue'), theme: 'pop' } }),
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
