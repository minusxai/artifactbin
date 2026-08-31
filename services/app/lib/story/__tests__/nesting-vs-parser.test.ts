/**
 * The nesting rule, checked against a real HTML parser over every shape the
 * story vocabulary can make — not against anyone's reading of the spec.
 *
 * This exists because the reading was wrong. The first version of the rule
 * looked only at a `<p>`'s DIRECT children; the parser does not. It closes a
 * paragraph at a block start tag met while the paragraph is open, however deep
 * — `<p><span><div>` breaks exactly as `<p><div>` does — and a first sweep of
 * 252 shapes failed 224 of them. It also stops looking at a button-scope
 * element (`<p><button><div>` is fine), and inside `<svg>` it is in foreign
 * content, where only the breakout list counts (`<svg><div>` closes the
 * paragraph, `<svg><figure>` does not).
 *
 * So the parser is the oracle. Each shape is parsed twice — once inside a
 * `<p>`, once inside a `<div>` — and if the paragraph version comes back with
 * fewer elements, the parser closed it and the rule MUST rewrite. If not, the
 * rule must leave it alone: rewriting a paragraph that never broke changes a
 * document's typography for nothing.
 *
 * Two-sided on purpose. A one-sided check ("is anything re-parented?") is
 * satisfied by rewriting every paragraph in sight.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { fixHtmlNesting } from '@/lib/story/nesting';

const BLOCKS = ['div','ul','ol','table','figure','blockquote','section','article','aside','header','footer','main','nav','h1','h2','h3','h4','h5','h6','pre','hr','dl','details','summary','address','fieldset','p','li','dd','dt'];
const WRAPPERS = ['span','a','em','strong','small','label','code','sub','sup','mark','q','cite','ins','del','b','i','u','abbr','time','data','output','meter','progress','video','audio','picture','canvas'];
const SCOPE = ['button','template','svg','object'];
const PHRASING = ['span','a','em','strong','code','img','br','small','sup','time','mark','input','label','button','select','textarea'];

const body = (t: string): string =>
  t === 'ul' ? '<ul><li>a</li></ul>'
  : t === 'ol' ? '<ol><li>a</li></ol>'
  : t === 'table' ? '<table><tbody><tr><td>a</td></tr></tbody></table>'
  : t === 'dl' ? '<dl><dt>a</dt><dd>b</dd></dl>'
  : ['hr','br','img','input'].includes(t) ? `<${t} />`
  : `<${t}>a</${t}>`;

/** Raw HTML equivalent of a JSX fragment, for handing to a real parser. */
const raw = (jsx: string) => jsx.replace(/className=/g, 'class=').replace(/ \/>/g, '>');

/**
 * The oracle: parse the shape with the paragraph INTACT and ask the browser's
 * own parser whether everything stayed inside it. If anything moved, the rule
 * must rewrite; if nothing moved, the rule must not.
 */
/*
 * ONE document, reused. Building a fresh JSDOM per shape is ~2,200 of them and
 * killed a CI worker outright ("Worker exited unexpectedly", 99 of 100 files
 * reporting) while passing on a laptop with more memory. Verified equivalent
 * across all 1,980 shape/tag pairs before switching: fragment parsing in body
 * context, in a standards-mode document, agrees with a full parse everywhere
 * here — and the doctype matters, since quirks mode alone changes whether
 * `<table>` closes a paragraph.
 */
const DOM = new JSDOM('<!DOCTYPE html><body></body>');

const held = (inner: string, tag: 'p' | 'div'): number => {
  const doc = DOM.window.document;
  doc.body.innerHTML = `<${tag} id="host">text ${raw(inner)}</${tag}>`;
  return doc.querySelector('#host')!.querySelectorAll('*').length;
};

function parserClosesParagraph(inner: string): boolean {
  return held(inner, 'p') !== held(inner, 'div');
}

const rewrites = (inner: string): boolean => {
  const parsed = parseJsx(`<p className="k">text ${inner}</p>`);
  if (!parsed.ok) throw new Error(`${inner}: ${parsed.error}`);
  return !serializeJsx(fixHtmlNesting(parsed.nodes)).startsWith('<p ');
};

describe('the nesting rule agrees with a real HTML parser on every shape', () => {
  it('over every block, through every inline wrapper and every scope element', () => {
    const shapes: Array<[string, string]> = [];
    for (const b of BLOCKS) {
      shapes.push([`direct:${b}`, body(b)]);
      for (const w of WRAPPERS) shapes.push([`${w}>${b}`, `<${w}>t ${body(b)}</${w}>`]);
      for (const w of SCOPE) shapes.push([`${w}>${b}`, `<${w}>t ${body(b)}</${w}>`]);
      shapes.push([`span>em>${b}`, `<span><em>${body(b)}</em></span>`]);
      shapes.push([`a>span>strong>${b}`, `<a href="/x"><span><strong>${body(b)}</strong></span></a>`]);
      shapes.push([`button>span>${b}`, `<button><span>${body(b)}</span></button>`]);
      shapes.push([`${b}+text`, `${body(b)} trailing words`]);
    }
    for (const p of PHRASING) {
      shapes.push([`phrasing:${p}`, body(p)]);
      shapes.push([`span>${p}`, `<span>${body(p)}</span>`]);
    }
    // Components: never rewritten for, whatever they wrap.
    for (const c of ['<Number data="$q" />', '<Card><CardContent>c</CardContent></Card>', '<Icon name="star" />']) {
      shapes.push([`component:${c.slice(0, 12)}`, c]);
      shapes.push([`span>component:${c.slice(0, 12)}`, `<span>${c}</span>`]);
    }

    const wrong: string[] = [];
    for (const [name, inner] of shapes) {
      const mustRewrite = parserClosesParagraph(inner);
      const didRewrite = rewrites(inner);
      // A component's rendered box is unknowable from the AST, so the rule
      // deliberately never fires for one — the oracle cannot judge those.
      if (name.includes('component')) {
        if (didRewrite) wrong.push(`${name}: rewrote for a component`);
        continue;
      }
      if (mustRewrite !== didRewrite) wrong.push(`${name}: parser closes p=${mustRewrite}, rule rewrites=${didRewrite}`);
    }
    if (wrong.length) console.log(`\nSHAPES ${shapes.length}  DISAGREEING ${wrong.length}\n   ` + wrong.slice(0, 25).join('\n   '));
    expect(wrong).toEqual([]);
    expect(shapes.length).toBeGreaterThan(900);
  }, 300000);
});
