// DESTINATION: services/app/lib/islands/__tests__/kit-parity.ts
/**
 * KIT PARITY, AT UNIT LEVEL. The parity gate (scripts/gate-compiled-parity.mjs) is the definition of
 * "identical"; this helper lets a kit port prove the same thing in jsdom without a server: render a
 * markup snippet with today's React kit (the interpreter, as the reader renders it) and with the
 * Solid port, and compare the two DOMs element by element — tags, attribute sets (generated ids
 * normalised, `data-hk`/`data-mx-ast` dropped, class tokens as a set), direct text.
 *
 * Owned by the toolchain track; every kit family's tests import it.
 */
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { parseJsx } from '@/lib/jsx';
import type { JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { IconGlyphProvider } from '@/components/kit/icon';

/** The reader's render of `markup` today: the interpreter over the parsed nodes, to static markup. */
export function reactRender(markup: string): string {
  const parsed = parseJsx(markup) as { nodes?: JsxNode[]; errors?: unknown[] };
  if (!parsed.nodes || parsed.errors?.length) throw new Error(`markup does not parse: ${JSON.stringify(parsed.errors)}`);
  return renderToStaticMarkup(createElement(IconGlyphProvider, { value: {} }, createElement(Fragment, null, renderStoryNodes(parsed.nodes, { values: {}, components: STORY_UI_COMPONENTS }))))
    .replace(/<link rel="preload"[^>]*>/g, '').replace(/<!-- -->/g, '');
}

export interface Shape { tag: string; attrs: Record<string, string>; text: string; kids: Shape[] }
const GENERATED = /^(radix-[^\s]*|«r[^»]*»|_R_[^\s]*_|cl-[\w-]+|s\d+-\d+)$/;
const DROP = new Set(['data-hk', 'data-mx-ast']);
const IDREF = new Set(['id', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'for']);

/** The comparable shape of an HTML string (or an element): what a reader would notice. */
export function shapeOf(html: string | Element): Shape[] {
  const root = typeof html === 'string' ? new JSDOM(`<div id="__root">${html}</div>`).window.document.getElementById('__root')! : html;
  const ids = new Map<string, string>();
  const norm = (v: string) => v.split(/\s+/).map((t) => (GENERATED.test(t) ? (ids.has(t) || ids.set(t, `G${ids.size + 1}`), ids.get(t)!) : t)).join(' ');
  const walk = (el: Element): Shape => {
    const attrs: Record<string, string> = {};
    for (const a of el.attributes) {
      if (DROP.has(a.name)) continue;
      attrs[a.name] = a.name === 'class' ? [...new Set(a.value.split(/\s+/).filter(Boolean))].sort().join(' ') : IDREF.has(a.name) ? norm(a.value) : a.value;
    }
    return { tag: el.tagName.toLowerCase(), attrs, text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''), kids: [...el.children].map(walk) };
  };
  return [...root.children].map(walk);
}

/** Every difference between two shapes, as one line each; empty means parity. */
export function diffShapes(a: Shape[], b: Shape[], path = ''): string[] {
  const out: string[] = [];
  if (a.length !== b.length) out.push(`${path || 'root'}: ${a.length} vs ${b.length} children`);
  a.forEach((x, i) => {
    const y = b[i];
    const at = `${path}/${i}<${x.tag}>`;
    if (!y || x.tag !== y.tag) { out.push(`${at}: tag ${x.tag} vs ${y?.tag}`); return; }
    for (const n of new Set([...Object.keys(x.attrs), ...Object.keys(y.attrs)])) if (x.attrs[n] !== y.attrs[n]) out.push(`${at} @${n}: ${JSON.stringify(x.attrs[n])} vs ${JSON.stringify(y.attrs[n])}`);
    if (x.text !== y.text) out.push(`${at} text: ${JSON.stringify(x.text)} vs ${JSON.stringify(y.text)}`);
    out.push(...diffShapes(x.kids, y.kids, at));
  });
  return out;
}

/** Parity of a Solid render (an element, or its HTML) against today's render of `markup`. */
export const parityOf = (markup: string, solid: string | Element): string[] => diffShapes(shapeOf(reactRender(markup)), shapeOf(solid));
