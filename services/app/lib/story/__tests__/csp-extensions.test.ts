/** The Helmet `csp-*` metas: what parses, what is refused (with the value and a span), and the header append. */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet } from '../document/helmet';
import { coversCspExtensions, cspExtensionsOf, mergeCspExtensions, parseCspOrigin, storedCspExtensions, EMPTY_CSP_EXTENSIONS } from '../document/csp-extensions';
import { validateMarkupStructure } from '../document/local-validation';
import { prepareJsx } from '../document/jsx-tier';
import { appendCspExtensions, buildDocumentCsp } from '@/lib/trust/document-csp-stub';

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
  it('reads the four directives, canonical and de-duplicated, ignoring other metas', () => {
    const { result } = helmetOf('<meta name="csp-connect" content="https://api.open-meteo.com  https://API.open-meteo.com https://api.example.com" /><meta name="csp-script" content="https://cdn.plot.ly" /><meta name="csp-style" content="https://cdn.example.com" /><meta name="csp-img" content="https://*.images.example.com" /><meta name="font-display" content="Lobster" />');
    expect(result).toEqual({ ok: true, extensions: {
      connect: ['https://api.open-meteo.com', 'https://api.example.com'],
      script: ['https://cdn.plot.ly'], style: ['https://cdn.example.com'], img: ['https://*.images.example.com'],
    } });
  });

  it('is empty for a document that asks nothing', () => {
    expect(helmetOf('<title>t</title>').result).toEqual({ ok: true, extensions: EMPTY_CSP_EXTENSIONS });
  });

  it('names the offending value and points at the content attribute', () => {
    const { source, result } = helmetOf('<meta name="csp-connect" content="https://ok.example.com http://bad.example.com" />');
    expect(result.ok).toBe(false);
    const [error] = result.ok ? [] : result.errors;
    expect(error).toMatchObject({ value: 'http://bad.example.com', tag: 'meta', attr: 'content' });
    expect(error!.message).toContain('"http://bad.example.com"');
    expect(source.slice(error!.start, error!.end)).toBe('content="https://ok.example.com http://bad.example.com"');
  });

  it('refuses an unknown csp directive by name, listing the four', () => {
    const { result } = helmetOf('<meta name="csp-frame" content="https://x.example.com" />');
    expect(result.ok ? [] : result.errors.map((e) => [e.value, e.message])).toEqual([['csp-frame', expect.stringContaining('csp-connect, csp-script, csp-style, csp-img')]]);
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

  it('publish stores the set on the content meta, and stores nothing for a document that asks nothing', async () => {
    const asked = await prepareJsx({}, '<Helmet><meta name="csp-connect" content="https://api.open-meteo.com" /></Helmet><p>x</p>');
    if (asked instanceof Response) throw new Error(await asked.text());
    expect(asked.content.meta.cspExtensions).toEqual({ connect: ['https://api.open-meteo.com'], script: [], style: [], img: [] });
    const plain = await prepareJsx({}, '<p>x</p>');
    if (plain instanceof Response) throw new Error(await plain.text());
    expect(plain.content.meta).not.toHaveProperty('cspExtensions');
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
  const ask = { connect: ['https://a.example.com'], script: ['https://cdn.plot.ly'], style: [], img: [] };
  it('a grant covers a set only when it holds every origin', () => {
    expect(coversCspExtensions(ask, ask)).toBe(true);
    expect(coversCspExtensions(ask, { ...ask, connect: ['https://a.example.com', 'https://b.example.com'] })).toBe(false);
    expect(coversCspExtensions(mergeCspExtensions(ask, { ...EMPTY_CSP_EXTENSIONS, connect: ['https://b.example.com'] }), { ...ask, connect: ['https://b.example.com'] })).toBe(true);
  });

  it('a stored set is read back defensively', () => {
    expect(storedCspExtensions({ cspExtensions: { connect: ['https://a.example.com', "https://x.com; script-src 'unsafe-eval'", 7], script: 'https://cdn.plot.ly' } }))
      .toEqual({ connect: ['https://a.example.com'], script: [], style: [], img: [] });
    expect(storedCspExtensions(null)).toEqual(EMPTY_CSP_EXTENSIONS);
  });
});

describe('appending to the served policy (stub until brief A)', () => {
  const policy = "default-src 'none'; script-src 'self' https://esm.sh; connect-src 'self'; style-src 'self'; form-action 'none'";
  it('is the identity on an empty set', () => {
    expect(appendCspExtensions(policy, EMPTY_CSP_EXTENSIONS)).toBe(policy);
    expect(appendCspExtensions(policy)).toBe(policy);
  });

  it('appends each origin to its own directive once, and never adds a missing directive', () => {
    expect(appendCspExtensions(policy, { connect: ['https://api.open-meteo.com'], script: ['https://esm.sh', 'https://cdn.plot.ly'], style: [], img: ['https://images.example.com'] }))
      .toBe("default-src 'none'; script-src 'self' https://esm.sh https://cdn.plot.ly; connect-src 'self' https://api.open-meteo.com; style-src 'self'; form-action 'none'");
  });

  it('buildDocumentCsp keeps the signature brief A ships', () => {
    const header = buildDocumentCsp({ self: 'https://abc.pages.example.com', extensions: { ...EMPTY_CSP_EXTENSIONS, connect: ['https://api.open-meteo.com'] } });
    expect(header).toMatch(/connect-src https:\/\/abc\.pages\.example\.com [^;]* https:\/\/api\.open-meteo\.com/);
    expect(buildDocumentCsp({ self: 'https://abc.pages.example.com' })).not.toContain('open-meteo');
  });
});
