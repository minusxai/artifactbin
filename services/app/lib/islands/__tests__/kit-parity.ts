// DESTINATION: services/app/lib/islands/__tests__/kit-parity.ts
/**
 * KIT PARITY, AT UNIT LEVEL: a markup snippet's recorded React-kit render (the retired interpreter, as the
 * reader drew it) against the Solid port's, compared element by element — tags, attribute sets (generated ids
 * normalised, `data-hk`/`data-mx-ast` dropped, class tokens as a set), direct text.
 *
 * Owned by the toolchain track; every kit family's tests import it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import type { Scalar, TableResult } from '@/lib/dataflow';

interface ParityData { tables?: Record<string, TableResult>; values?: Record<string, Scalar> }

/**
 * The React kit's render of `markup`, as the retired interpreter drew it — recorded (./fixtures/react-oracle.json,
 * keyed by markup and data) from the retired React reader before it was deleted, so the Solid kit keeps proving the same
 * DOM. A markup the oracle never saw has no reference: add the case with an explicit expected shape instead.
 */
let oracle: Record<string, string> | null = null;
/** Shared reader layout contracts added after the retired React reader was captured. */
export function applyCurrentLayoutContracts(html: string): string {
  // Segmented options now mark the chosen one with the system's primary fill, look clickable and show focus.
  const segment = 'relative h-8 cursor-pointer rounded-[5px] px-3 text-sm transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
  html = html
    .replaceAll('class="h-8 rounded-[5px] px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 bg-background text-foreground shadow-xs"', `class="${segment} bg-primary text-primary-foreground shadow-xs"`)
    .replaceAll('class="h-8 rounded-[5px] px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 text-muted-foreground hover:text-foreground"', `class="${segment} text-muted-foreground enabled:hover:bg-foreground/10 enabled:hover:text-foreground"`);
  // Tabs take Segmented's contract: the chosen tab wears the system's primary fill in both modes, idle tabs tint on hover,
  // every tab looks clickable and shows Segmented's focus ring; the line variant's underline takes the primary colour.
  // The recorded quote inside `[class*='size-']` is either `'` or `&#x27;`; the same one is written back.
  html = html.replace(/class="relative inline-flex h-\[calc\(100%-1px\)\] flex-1 items-center justify-center gap-1\.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground\/60 transition-all group-data-\[orientation=vertical\]\/tabs:w-full group-data-\[orientation=vertical\]\/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-\[3px\] focus-visible:ring-ring\/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-\[variant=default\]\/tabs-list:data-\[state=active\]:shadow-sm group-data-\[variant=line\]\/tabs-list:data-\[state=active\]:shadow-none dark:text-muted-foreground dark:hover:text-foreground \[&amp;_svg\]:pointer-events-none \[&amp;_svg\]:shrink-0 \[&amp;_svg:not\(\[class\*=('|&#x27;)size-\1\]\)\]:size-4 group-data-\[variant=line\]\/tabs-list:bg-transparent group-data-\[variant=line\]\/tabs-list:data-\[state=active\]:bg-transparent dark:group-data-\[variant=line\]\/tabs-list:data-\[state=active\]:border-transparent dark:group-data-\[variant=line\]\/tabs-list:data-\[state=active\]:bg-transparent data-\[state=active\]:bg-background data-\[state=active\]:text-foreground dark:data-\[state=active\]:border-input dark:data-\[state=active\]:bg-input\/30 dark:data-\[state=active\]:text-foreground after:absolute after:bg-foreground /g,
    (_match, quote: string) => `class="relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:shrink-0 [&amp;_svg:not([class*=${quote}size-${quote}])]:size-4 data-[state=inactive]:hover:bg-foreground/10 data-[state=inactive]:hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-xs group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none after:absolute after:bg-primary `);
  // The pending diagnostics chunk starts with readable text during SSR and initial hydration.
  // It adds the same spinner after loading; settled tables never download that chunk.
  html = html.replace(/(<div\b[^>]*aria-label="DataTable embed"[^>]*>)<span(?: data-hk="[^"]*")? aria-hidden="true" class="size-\[22px\] animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none"><\/span><span(?: data-hk="[^"]*")? class="font-mono text-\[11px\] font-medium uppercase tracking-\[0\.08em\] text-muted-foreground">loading data…<\/span>/g, '$1loading data…');
  // Keep the DataTable upgrade confined to its identity-bearing adapter wrapper and preserve every
  // other captured byte. Its inner overflow container already owns horizontal scrolling.
  const withDataTableWidth = html.replace(/<div\b[^>]*\baria-label="DataTable embed"[^>]*>/g, (opening) => {
    const style = opening.match(/\bstyle="([^"]*)"/);
    if (!style || !/(?:^|;)\s*width:\s*100%\s*(?:;|$)/.test(style[1]!) || /(?:^|;)\s*min-width\s*:/i.test(style[1]!)) return opening;
    const updated = `${style[1]}${style[1]!.endsWith(';') ? '' : ';'}min-width:0`;
    return opening.replace(style[0], `style="${updated}"`);
  });
  // Fixed virtual grid tracks now clip at the cell boundary; preserve complete captured text.
  // Adapt only the shared DataGrid, leaving authored HTML tables and frozen records untouched.
  const withDataTableCells = withDataTableWidth.replace(/<table\b[^>]*\bdata-mx-kit-table[^>]*>[\s\S]*?<\/table>/g, table => table
    .replace(/class="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-bold"/g, 'class="min-w-0 cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-bold"')
    .replace(/<td\b[^>]*class="relative whitespace-nowrap[^>]*>[\s\S]*?<\/td>/g, cell => cell
      .replace('class="relative whitespace-nowrap', 'class="relative min-w-0 overflow-hidden whitespace-nowrap')
      .replace('<span class="relative">', '<span class="relative block min-w-0 max-w-full truncate">')));
  if (!withDataTableCells.includes('data-mx-slide')) return withDataTableCells;
  const root = new JSDOM(`<div id="__slide-layout-reference">${withDataTableCells}</div>`).window.document.getElementById('__slide-layout-reference')!;
  for (const slide of root.querySelectorAll<HTMLElement>('[data-mx-slide]')) {
    const classes = slide.getAttribute('class') ?? '';
    if (/(?:^|\s)w-full(?:\s|$)/.test(classes) && /(?:^|\s)min-w-0(?:\s|$)/.test(classes)) continue;
    // The captured classes already include the old static Slide recipe. Add the new sizing
    // utilities beside that base recipe without re-running the merger over authored classes.
    const current = classes.startsWith('relative flex ')
      ? classes.replace(/^relative flex /, 'relative flex w-full min-w-0 ')
      : classes.startsWith('relative ')
        ? classes.replace(/^relative /, 'relative w-full min-w-0 ')
        : classes;
    slide.setAttribute('class', current);
  }
  return root.innerHTML;
}

export function reactRender(markup: string, data?: ParityData): string {
  oracle ??= JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'react-oracle.json'), 'utf8')) as Record<string, string>;
  const recorded = oracle[JSON.stringify({ markup, data: data ?? null })];
  if (recorded === undefined) throw new Error(`no recorded React render for ${JSON.stringify(markup).slice(0, 120)}`);
  return applyCurrentLayoutContracts(recorded);
}

export interface Shape { tag: string; attrs: Record<string, string>; text: string; kids: Shape[] }
const GENERATED = /^(radix-[^\s]*|«r[^»]*»|_R_[^\s]*_|cl-[\w-]+|s\d+-\d+)$/;
const DROP = new Set(['data-hk', 'data-mx-ast', 'data-mx-live', 'data-mx-source-node-id']);
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
      // The retired React kit can emit a dangling idref when an author supplies an id.
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
