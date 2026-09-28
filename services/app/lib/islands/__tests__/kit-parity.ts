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
import { createElement, Fragment, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { parseJsx } from '@/lib/jsx';
import type { JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { IconGlyphProvider } from '@/components/kit/icon';
import InlineNumber from '@/components/views/story/InlineNumber';
import QuestionEmbed from '@/components/views/story/QuestionEmbed';
import { SelectControl, normalizeControlOptions } from '@/components/kit/controls';
import { DataTable } from '@/components/kit/data-table';
import { parseColumnSpecs, parseSortSpec } from '@/lib/story/data-table';
import { refName, type Scalar, type TableResult } from '@/lib/story/dataflow';

export interface ParityData { tables?: Record<string, TableResult>; values?: Record<string, Scalar> }

/** The reader's render of `markup` today: the interpreter over the parsed nodes, to static markup. */
export function reactRender(markup: string, data?: ParityData): string {
  const parsed = parseJsx(markup) as { nodes?: JsxNode[]; errors?: unknown[] };
  if (!parsed.nodes || parsed.errors?.length) throw new Error(`markup does not parse: ${JSON.stringify(parsed.errors)}`);
  const components = data ? { ...STORY_UI_COMPONENTS,
    Number: (props: Record<string, unknown>) => createElement('span', { id: props.id as string, 'aria-busy': false }, createElement(InlineNumber, { data: props.data, ...props, tables: data.tables })),
    Question: (props: Record<string, unknown>) => createElement(QuestionEmbed, { data: props.data, viz: props.viz as Record<string, unknown>, ...props, tables: data.tables, colorMode: 'light' }),
    Select: (props: Record<string, unknown>) => {
      const valueName = refName(props.value);
      const optionName = refName(props.options);
      return createElement(SelectControl, { label: props.label as string, placeholder: props.placeholder as string, className: props.className as string,
        options: normalizeControlOptions(props.options, optionName ? data.tables?.[optionName] : undefined),
        value: valueName ? String(data.values?.[valueName] ?? '') : String(props.value ?? ''), nullable: true,
        onChange: () => {}, bound: [valueName && `value:$${valueName}`, optionName && `options:$${optionName}`].filter(Boolean).join(' '),
        rest: { id: props.id },
      });
    },
    DataTable: (props: Record<string, unknown>) => {
      const table = data.tables?.[refName(props.data) ?? ''];
      return createElement(DataTable as ComponentType<Record<string, unknown>>, { rows: table?.rows, columns: table?.columns, spec: parseColumnSpecs(props.columns), sort: parseSortSpec(props.sort), height: props.height as string,
        className: props.className as string, id: props.id as string });
    },
  } : STORY_UI_COMPONENTS;
  return renderToStaticMarkup(createElement(IconGlyphProvider, { value: {} }, createElement(Fragment, null, renderStoryNodes(parsed.nodes, { values: data?.values ?? {}, components }))))
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
      attrs[a.name] = a.name === 'class' ? [...new Set(a.value.split(/\s+/).filter(Boolean))].sort().join(' ') : a.name === 'style' ? a.value.split(';').map(part => part.trim().replace(/\s*:\s*/, ':')).filter(Boolean).sort().join(';') : IDREF.has(a.name) ? norm(a.value) : a.value;
    }
    return { tag: el.tagName.toLowerCase(), attrs, text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''), kids: [...el.children].map(walk) };
  };
  return [...root.children].map(walk);
}

/** Every difference between two shapes, as one line each; empty means parity. */
export function diffShapes(a: Shape[], b: Shape[], path = '', reactIds?: Set<string>): string[] {
  reactIds ??= new Set<string>();
  if (!path) {
    const collect = (nodes: Shape[]) => { for (const node of nodes) { if (node.attrs.id) reactIds!.add(node.attrs.id); collect(node.kids); } };
    collect(a);
  }
  const out: string[] = [];
  if (a.length !== b.length) out.push(`${path || 'root'}: ${a.length} vs ${b.length} children`);
  a.forEach((x, i) => {
    const y = b[i];
    const at = `${path}/${i}<${x.tag}>`;
    if (!y || x.tag !== y.tag) { out.push(`${at}: tag ${x.tag} vs ${y?.tag}`); return; }
    for (const n of new Set([...Object.keys(x.attrs), ...Object.keys(y.attrs)])) if (x.attrs[n] !== y.attrs[n]) {
      // Today's React kit can emit a dangling idref when an author supplies an id.
      // Accept a corrected Solid idref only when React's referenced element is absent.
      const reactRef = x.attrs[n];
      if ((n === 'aria-controls' || n === 'aria-labelledby') && reactRef && !reactRef.includes(' ') && !reactIds.has(reactRef)) continue;
      out.push(`${at} @${n}: ${JSON.stringify(x.attrs[n])} vs ${JSON.stringify(y.attrs[n])}`);
    }
    if (x.text !== y.text) out.push(`${at} text: ${JSON.stringify(x.text)} vs ${JSON.stringify(y.text)}`);
    out.push(...diffShapes(x.kids, y.kids, at, reactIds));
  });
  return out;
}

/** Parity of a Solid render (an element, or its HTML) against today's render of `markup`. */
export const parityOf = (markup: string, solid: string | Element, data?: ParityData): string[] => diffShapes(shapeOf(reactRender(markup, data)), shapeOf(solid));
