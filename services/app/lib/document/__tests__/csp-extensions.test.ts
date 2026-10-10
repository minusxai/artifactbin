/** The Helmet `csp-*` metas: what parses, what is refused (with the value and a span), and the header append. */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '../helmet';
import { coversCspExtensions, cspExtensionsOf, mergeCspExtensions, parseCspOrigin, storedCspExtensions, EMPTY_CSP_EXTENSIONS } from '../csp-extensions';
import { validateMarkupStructure } from '../local-validation';
import { prepareJsx } from '../../publish/document/jsx-tier';
import { buildDocumentCsp } from '@/lib/compiled-page/styles/document-csp';
import { appendCspExtensions } from '@/lib/compiled-page/styles/markup-csp';

const helmetOf = (metas: string) => {
  const source = `<Helmet>${metas}</Helmet><p>x</p>`;
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  const split = splitHelmet(parsed.nodes);
  return { source, result: cspExtensionsOf(split.content, split.helmet) };
};

describe('parseCspOrigin', () => {
  it.each([
    ['https://api.open-meteo.com', 'https://api.open-meteo.com'],
    ['https://API.Example.com', 'https://api.example.com'],
    ['https://cdn.plot.ly/', 'https://cdn.plot.ly'],
    ['https://*.example.com', 'https://*.example.com'],
    ['https://example.com:8443', 'https://example.com:8443'],
  ])('accepts %s', (written, origin) => {
    expect(parseCspOrigin(written)).toEqual({ ok: true, origin });
  });

  it.each([
    ['http://api.example.com', 'https://'],
    ['api.example.com', 'https://'],
    ['https://api.example.com/v1', 'no path'],
    ['https://api.example.com?x=1', 'no path'],
    ['https://user@api.example.com', 'credentials'],
    ['https://*', 'wildcard'],
    ['https://*.com', 'subdomain'],
    ['https://a.*.example.com', 'wildcard'],
    ['https://*example.com', 'wildcard'],
    ["https://x.com;script-src", 'valid host'],
    ["https://x.com'", 'valid host'],
    ['https://example.com:99999', 'port'],
    ['*', 'https://'],
  ])('refuses %s', (written, reason) => {
    const parsed = parseCspOrigin(written);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.reason).toContain(reason);
  });
});

describe('cspExtensionsOf', () => {
  it('reads the six directives, canonical and de-duplicated, ignoring other metas', () => {
    const { result } = helmetOf('<meta name="csp-connect" content="https://api.open-meteo.com  https://API.open-meteo.com https://api.example.com" /><meta name="csp-script" content="https://cdn.plot.ly" /><meta name="csp-style" content="https://cdn.example.com" /><meta name="csp-img" content="https://*.images.example.com" /><meta name="csp-frame" content="https://www.youtube-nocookie.com" /><meta name="csp-media" content="https://media.example.com" /><meta name="font-display" content="Lobster" />');
    expect(result).toEqual({ ok: true, extensions: {
      connect: ['https://api.open-meteo.com', 'https://api.example.com'],
      script: ['https://cdn.plot.ly'], style: ['https://cdn.example.com'], img: ['https://*.images.example.com'],
      frame: ['https://www.youtube-nocookie.com'], media: ['https://media.example.com'],
    } });
  });

  it('is empty for a document that asks nothing', () => {
    expect(helmetOf('<title>t</title>').result).toEqual({ ok: true, extensions: EMPTY_CSP_EXTENSIONS });
  });

  it('keeps the origins that did validate beside the refusal (what an unvalidated edit can still ask for)', () => {
    const { result } = helmetOf('<meta name="csp-connect" content="https://ok.example.com http://bad.example.com" />');
    expect(result.extensions.connect).toEqual(['https://ok.example.com']);
  });

  it('names the offending value and points at the content attribute', () => {
    const { source, result } = helmetOf('<meta name="csp-connect" content="https://ok.example.com http://bad.example.com" />');
    expect(result.ok).toBe(false);
    const [error] = result.ok ? [] : result.errors;
    expect(error).toMatchObject({ value: 'http://bad.example.com', tag: 'meta', attr: 'content' });
    expect(error!.message).toContain('"http://bad.example.com"');
    expect(source.slice(error!.start, error!.end)).toBe('content="https://ok.example.com http://bad.example.com"');
  });

  it('refuses an unknown csp directive by name, listing the six (fonts ride on csp-style)', () => {
    const { result } = helmetOf('<meta name="csp-font" content="https://x.example.com" />');
    expect(result.ok ? [] : result.errors.map((e) => [e.value, e.message])).toEqual([['csp-font', expect.stringContaining('csp-connect, csp-script, csp-style, csp-img, csp-frame, csp-media')]]);
  });

  it('validates csp-frame and csp-media like the rest', () => {
    const bad = helmetOf('<meta name="csp-frame" content="https://player.example.com/embed" /><meta name="csp-media" content="http://media.example.com" />').result;
    expect(bad.ok ? [] : bad.errors.map((e) => e.value)).toEqual(['https://player.example.com/embed', 'http://media.example.com']);
  });

  it('refuses an empty list and more than ten origins', () => {
    expect(helmetOf('<meta name="csp-img" content="  " />').result.ok).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `https://h${i}.example.com`).join(' ');
    const ten = Array.from({ length: 10 }, (_, i) => `https://h${i}.example.com`).join(' ');
    const over = helmetOf(`<meta name="csp-connect" content="${eleven}" />`).result;
    expect(over.ok ? '' : over.errors[0]!.message).toContain('the cap is 10');
    expect(helmetOf(`<meta name="csp-connect" content="${ten}" />`).result.ok).toBe(true);
  });
});

describe('the publish door and afbin validate', () => {
  it('publish refuses a bad origin as invalid_csp with the value, not as invalid_jsx', async () => {
    const answer = await prepareJsx({}, '<Helmet><meta name="csp-connect" content="https://api.example.com/v1" /></Helmet><p>x</p>');
    expect(answer).toBeInstanceOf(Response);
    const response = answer as Response;
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string; details: Array<{ value: string; message: string }> };
    expect(body.error).toBe('invalid_csp');
    expect(body.details[0]!.value).toBe('https://api.example.com/v1');
  });

  it('publish stores nothing beside the source: each version\'s source is its declaration', async () => {
    const asked = await prepareJsx({}, '<Helmet><meta name="csp-connect" content="https://api.open-meteo.com" /></Helmet><p>x</p>');
    if (asked instanceof Response) throw new Error(await asked.text());
    expect(asked.content.meta).not.toHaveProperty('cspExtensions');
    expect(asked.content.source).toContain('csp-connect');
  });

  it('local validation (the CLI) reports the same refusal with its span', () => {
    const source = '<Helmet><meta name="csp-script" content="https://*" /></Helmet><p>x</p>';
    const errors = validateMarkupStructure(source).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('wildcard');
    expect(source.slice(errors[0]!.start, errors[0]!.end)).toBe('content="https://*"');
  });
});

describe('sets', () => {
  const ask = { ...EMPTY_CSP_EXTENSIONS, connect: ['https://a.example.com'], script: ['https://cdn.plot.ly'] };
  it('a grant covers a set only when it holds every origin', () => {
    expect(coversCspExtensions(ask, ask)).toBe(true);
    expect(coversCspExtensions(ask, { ...ask, connect: ['https://a.example.com', 'https://b.example.com'] })).toBe(false);
    expect(coversCspExtensions(mergeCspExtensions(ask, { ...EMPTY_CSP_EXTENSIONS, connect: ['https://b.example.com'] }), { ...ask, connect: ['https://b.example.com'] })).toBe(true);
  });

  it('a stored set is read back defensively', () => {
    expect(storedCspExtensions({ connect: ['https://a.example.com', "https://x.com; script-src 'unsafe-eval'", 7], script: 'https://cdn.plot.ly' }))
      .toEqual({ ...EMPTY_CSP_EXTENSIONS, connect: ['https://a.example.com'] });
    expect(storedCspExtensions(null)).toEqual(EMPTY_CSP_EXTENSIONS);
  });
});

describe('the served document policy (lib/compiled-page/styles/document-csp)', () => {
  const base = { self: 'https://616263.pages.example.com', app: 'https://app.example.com', id: 'abc' };
  const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
  it('is the default policy on an empty set', () => {
    expect(buildDocumentCsp({ ...base, extensions: EMPTY_CSP_EXTENSIONS })).toBe(buildDocumentCsp(base));
  });

  it('appends each declared origin to its own directive; a connection goes through the /fetch door, never connect-src', () => {
    const csp = buildDocumentCsp({ ...base, extensions: { ...EMPTY_CSP_EXTENSIONS, connect: ['https://api.open-meteo.com'], script: ['https://cdn.plot.ly'], img: ['https://images.example.com'], media: ['https://media.example.com'] } });
    expect(directive(csp, 'script-src').split(' ').at(-1)).toBe('https://cdn.plot.ly');
    expect(directive(csp, 'img-src').split(' ').at(-1)).toBe('https://images.example.com');
    expect(directive(csp, 'media-src').split(' ').at(-1)).toBe('https://media.example.com');
    expect(csp).not.toContain('open-meteo');
    expect(directive(csp, 'connect-src')).toContain('https://app.example.com/a/abc/fetch');
  });

  it('csp-style extends fonts too, and a declared frame host joins the embed hosts', () => {
    const csp = buildDocumentCsp({ ...base, extensions: { ...EMPTY_CSP_EXTENSIONS, style: ['https://fonts.example.com'], frame: ['https://www.example-embed.com'] } });
    expect(directive(csp, 'style-src').split(' ').at(-1)).toBe('https://fonts.example.com');
    expect(directive(csp, 'font-src').split(' ').at(-1)).toBe('https://fonts.example.com');
    expect(directive(csp, 'frame-src').split(' ').at(-1)).toBe('https://www.example-embed.com');
  });

  it('takes every origin the publish grammar accepts, a wildcard label included', () => {
    const parsed = helmetOf('<meta name="csp-img" content="https://*.example.com" />').result;
    expect(parsed.ok).toBe(true);
    const csp = buildDocumentCsp({ ...base, extensions: parsed.extensions });
    expect(directive(csp, 'img-src').split(' ').at(-1)).toBe('https://*.example.com');
  });
});

describe('appending to the app origin\'s /raw policy (lib/compiled-page/styles/markup-csp)', () => {
  const policy = "default-src 'none'; script-src 'self' https://esm.sh; connect-src 'self'; style-src 'self'; font-src 'self'; frame-src 'none'; form-action 'none'";
  it('is the identity on an empty set', () => {
    expect(appendCspExtensions(policy, EMPTY_CSP_EXTENSIONS)).toBe(policy);
    expect(appendCspExtensions(policy)).toBe(policy);
  });

  it('appends each origin to its own directive once, and never adds a missing directive', () => {
    expect(appendCspExtensions(policy, { ...EMPTY_CSP_EXTENSIONS, connect: ['https://api.open-meteo.com'], script: ['https://esm.sh', 'https://cdn.plot.ly'], img: ['https://images.example.com'], media: ['https://media.example.com'] }))
      .toBe("default-src 'none'; script-src 'self' https://esm.sh https://cdn.plot.ly; connect-src 'self' https://api.open-meteo.com; style-src 'self'; font-src 'self'; frame-src 'none'; form-action 'none'");
  });

  it('csp-style extends fonts too, and a declared frame host replaces a lone none', () => {
    expect(appendCspExtensions(policy, { ...EMPTY_CSP_EXTENSIONS, style: ['https://fonts.example.com'], frame: ['https://www.youtube-nocookie.com'] }))
      .toBe("default-src 'none'; script-src 'self' https://esm.sh; connect-src 'self'; style-src 'self' https://fonts.example.com; font-src 'self' https://fonts.example.com; frame-src https://www.youtube-nocookie.com; form-action 'none'");
  });
});
