// validateJsx enforces the STATIC subset + security allowlist over a parsed AST.
// This is what makes `jsx` inert data, not code: JSON-literal attrs only, registered
// components only, allowed HTML tags, no event handlers, no dangerous URLs.
import { describe, it, expect } from 'vitest';
import { parseJsx } from '../parse';
import { validateJsx } from '../validate';
import { JSX_STORY_COMPONENT_NAMES } from '../components';
import type { ValidateOptions } from '../types';

const OPTS: ValidateOptions = { components: ['Question'] };

function errors(src: string, opts: ValidateOptions = OPTS) {
  const r = parseJsx(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error}`);
  return validateJsx(r.nodes, opts);
}

describe('validateJsx — valid input', () => {
  it('accepts a registered component with JSON-literal attrs + text child', () => {
    expect(errors(`<Question connection="github" viz={{type:"bar",xCols:["a"]}}>SELECT 1</Question>`)).toEqual([]);
  });
  it('accepts nested allowed HTML', () => {
    expect(errors(`<div class="soh"><h1>Title</h1><p>body</p></div>`)).toEqual([]);
  });
  it('allows a data:image URL', () => {
    expect(errors(`<img src="data:image/png;base64,iVBORw0KGgo=" />`)).toEqual([]);
  });
});

describe('validateJsx — static subset', () => {
  it('rejects a non-static attribute expression', () => {
    const errs = errors(`<Question viz={computeViz()} />`);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].attr).toBe('viz');
    expect(errs[0].message).toMatch(/json literal|static/i);
  });
  it('rejects a spread attribute', () => {
    expect(errors(`<Question {...spread} />`).length).toBeGreaterThan(0);
  });
  it('rejects a non-static expression child', () => {
    expect(errors(`<div>{fn()}</div>`).length).toBeGreaterThan(0);
  });
});

describe('validateJsx — security', () => {
  it('rejects a <script> tag', () => {
    const errs = errors(`<div><script>alert(1)</script></div>`);
    expect(errs.some((e) => e.tag === 'script')).toBe(true);
  });
  it.each(['iframe', 'object', 'embed', 'base', 'meta', 'link', 'form'])('rejects dangerous tag <%s>', (tag) => {
    expect(errors(`<${tag}></${tag}>`).length).toBeGreaterThan(0);
  });
  it('rejects an on* event handler (string)', () => {
    expect(errors(`<div onclick="steal()">x</div>`).length).toBeGreaterThan(0);
  });
  it('rejects an on* event handler (camelCase)', () => {
    expect(errors(`<div onClick={"steal"}>x</div>`).length).toBeGreaterThan(0);
  });
  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', ' vbscript:x', 'data:text/html,<script>'])(
    'rejects dangerous URL scheme %s',
    (url) => {
      expect(errors(`<a href="${url}">x</a>`).length).toBeGreaterThan(0);
    },
  );
});

describe('validateJsx — component registry', () => {
  it('rejects an unregistered component', () => {
    const errs = errors(`<Chart />`, { components: ['Question'] });
    expect(errs.some((e) => e.tag === 'Chart')).toBe(true);
  });
  it('accepts a component once registered', () => {
    expect(errors(`<Chart />`, { components: ['Question', 'Chart'] })).toEqual([]);
  });
  it('restricts HTML tags when allowedHtmlTags is provided', () => {
    expect(errors(`<marquee>x</marquee>`, { components: ['Question'], allowedHtmlTags: ['div', 'p'] }).length).toBeGreaterThan(0);
    expect(errors(`<div>x</div>`, { components: ['Question'], allowedHtmlTags: ['div', 'p'] })).toEqual([]);
  });
});

describe('validateJsx — no-inline-style policy', () => {
  const noInlineStyle: ValidateOptions = {
    components: ['Param'],
    allowedHtmlTags: ['div', 'style'],
    stylePolicy: 'no-inline-style',
  };

  /**
   * Authored CSS is still in-distribution vocabulary — custom keyframes and all
   * — it just has ONE home now. This used to assert the body spelling; the
   * document-level door (see below) is what replaced it, and `/docs/llm` had
   * already been telling agents `<Helmet><style>` for a while.
   */
  it('sends an authored <style> block to the Helmet rather than the body', () => {
    const errs = errors('<div><style>{`@keyframes rise { from { opacity: 0 } }`}</style></div>', noInlineStyle);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('<Helmet>');
  });

  it('still rejects inline HTML styles with recovery guidance', () => {
    const errs = errors('<div style="color:red">x</div>', noInlineStyle);
    expect(errs.some(e => e.attr === 'style' && e.message.includes('className'))).toBe(true);
  });

  it('rejects historical component style aliases but accepts literal Tailwind classes', () => {
    expect(errors('<Param labelStyle={{color:"red"}} />', noInlineStyle).some(e => e.attr === 'labelStyle')).toBe(true);
    expect(errors('<div className="text-[#ff0000] bg-muted">x</div>', noInlineStyle)).toEqual([]);
  });

  it('leaves the inline-style ATTRIBUTE alone under the default policy', () => {
    // The document-level rule is not a style policy: it applies whatever the
    // policy, while `style="…"` stays legal wherever the policy permits it.
    expect(errors('<div style="color:red">x</div>', {
      components: [],
      allowedHtmlTags: ['div'],
    })).toEqual([]);
  });
});

describe('validateJsx — unknown-component error guidance', () => {
  it('keeps the stable "Unknown component" prefix', () => {
    const errs = errors(`<Chart />`, { components: ['Question'] });
    expect(errs[0].message).toMatch(/^Unknown component <Chart> — not in the component registry/);
  });

  it('lists the registered components so the model can recover', () => {
    const errs = errors(`<Chart />`, { components: ['Question', 'Card'] });
    expect(errs[0].message).toContain('Question');
    expect(errs[0].message).toContain('Card');
  });

  it('flags a LEGACY story component with migration guidance', () => {
    // The exact failure mode of the bug: agent authors <PageHeader>/<Eyebrow>/<Headline>
    // in a new-format story. The error must say these are legacy and point at plain
    // HTML + Tailwind / the registered set — not just "unknown".
    for (const tag of ['PageHeader', 'Eyebrow', 'Headline']) {
      const errs = errors(`<${tag}>x</${tag}>`, { components: JSX_STORY_COMPONENT_NAMES });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs[0].message).toMatch(new RegExp(`^Unknown component <${tag}> — not in the component registry`));
      expect(errs[0].message).toMatch(/legacy/i);
      expect(errs[0].message).toMatch(/plain HTML/i);
    }
  });

  it('does not emit legacy guidance for an ordinary unknown component', () => {
    const errs = errors(`<Chart />`, { components: JSX_STORY_COMPONENT_NAMES });
    expect(errs[0].message).not.toMatch(/legacy/i);
  });
});

/**
 * `<title>` names the DOCUMENT, and a markup document has exactly one place for
 * that: `<Helmet><title>` (lib/story/helmet.ts). A bare `<title>` in the body
 * is not a second opinion, it is a hijack — the HTML parser processes a body
 * `<title>` under the in-head rules, and React hoists it too, so on a hydrating
 * document it lands in `<head>` and BEATS the Helmet title. Measured: a
 * document with `<Helmet><title>REAL</title>` and a stray `<title>HIJACKED</title>`
 * rendered a tab reading HIJACKED, with only that title in head.
 *
 * It reached the body at all because SVG has a `<title>` element too — same
 * name, different element, legitimately used as an accessibility label — and
 * the allowlist is flat.
 */
describe('validateJsx — <title> belongs to the Helmet', () => {
  const html = ['div', 'p', 'title', 'svg', 'g', 'path'];

  it('rejects a bare <title> in the body, and says where it belongs', () => {
    const errs = errors('<p>x</p><title>hijack</title>', { components: [], allowedHtmlTags: html });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('<Helmet>');
  });

  it('rejects it however deeply it is nested in ordinary markup', () => {
    const errs = errors('<div><p><title>hijack</title></p></div>', { components: [], allowedHtmlTags: html });
    expect(errs).toHaveLength(1);
  });

  it('keeps SVG’s <title> — the accessibility label, a different element', () => {
    expect(errors('<svg><title>a chart</title><path /></svg>', { components: [], allowedHtmlTags: html })).toEqual([]);
  });

  it('keeps it inside a nested SVG group', () => {
    expect(errors('<svg><g><title>group label</title></g></svg>', { components: [], allowedHtmlTags: html })).toEqual([]);
  });
});

/**
 * The tag rejection is an agent's only route to self-correction, exactly as the
 * unknown-component one is — and it named no alternatives at all. It now points
 * at the set, which the publish door attaches ONCE per response rather than
 * repeating the whole vocabulary per offending tag.
 */
describe('validateJsx — disallowed-tag guidance', () => {
  it('names the offending tag and points at the allowed set', () => {
    const errs = errors('<marquee>x</marquee>', { components: [], allowedHtmlTags: ['div', 'p', 'span'] });
    expect(errs[0].message).toContain('<marquee>');
    expect(errs[0].message).toContain('allowed_html_tags');
  });

  it('does not repeat the vocabulary once per offending tag', () => {
    const errs = errors('<marquee>a</marquee><blink>b</blink>', { components: [], allowedHtmlTags: ['div', 'p', 'span'] });
    expect(errs).toHaveLength(2);
    for (const e of errs) expect(e.message.length).toBeLessThan(120);
  });
});

/**
 * `<style>` is document-level in exactly the way `<title>` is: CSS in a body
 * `<style>` block is not scoped to where it sits, it applies to the whole
 * document. `/docs/llm` has told agents for a while that custom CSS lives in
 * `<Helmet><style>` — the door just kept accepting the other spelling too, so
 * a document could ship its stylesheet through either, and "one door" was true
 * of the documentation and not of the code.
 */
describe('validateJsx — <style> belongs to the Helmet', () => {
  const html = ['div', 'p', 'svg', 'path'];

  it('rejects a body <style>, and says where it belongs', () => {
    const errs = errors('<style>{`p{color:red}`}</style><p>x</p>', { components: [], allowedHtmlTags: html });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('<Helmet>');
  });

  it('rejects it however deeply it is nested', () => {
    const errs = errors('<div><p><style>{`p{color:red}`}</style></p></div>', { components: [], allowedHtmlTags: html });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('<Helmet>');
  });
});

/**
 * `<form>` is denied on purpose, and the purpose is NOT the reader's document —
 * there `form-action 'none'` already makes it inert. It is the edit canvas:
 * same-origin by design (the WYSIWYG needs contentDocument), with no sandbox
 * and no CSP, so a stored `<form action="/api/…" method="post">` would render
 * in the owner's canvas as a live cookie-carrying submit, in a document an
 * agent may have written. See lib/jsx/dangerous-tags.ts.
 */
describe('validateJsx — <form> stays denied', () => {
  it('refuses it even where every control it would group is allowed', () => {
    const opts = { components: [], allowedHtmlTags: ['form', 'input', 'button', 'label'] };
    expect(errors('<input /><button>go</button>', opts)).toEqual([]);
    const errs = errors('<form action="/api/artifacts"><input /><button>go</button></form>', opts);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('Disallowed tag <form>');
    // and it says what to do instead, like every other rejection here
    expect(errs[0].message).toMatch(/without a <form>|controls/i);
  });
});

/**
 * A denied tag is the one rejection that named no way forward. The unknown
 * component lists the registry, a refused tag points at `allowed_html_tags`,
 * document-level tags name the Helmet — but `<iframe>` and friends answered
 * `Disallowed tag <iframe>` and stopped. It costs nothing in the prompt to say
 * why, because it is paid only by an agent that got it wrong.
 */
describe('validateJsx — denied tags say what to do instead', () => {
  const opts = { components: [], allowedHtmlTags: ['div', 'p'] };
  it.each([
    ['<iframe src="https://example.com" />', /<Video>/],
    ['<script>{`x()`}</script>', /<Helmet>/],
    ['<base href="/x" />', /own/i],
  ])('guides %s', (markup, expected) => {
    const errs = errors(markup, opts);
    expect(errs[0].message).toMatch(expected);
  });
});
