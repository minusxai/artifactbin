/**
 * A STORED DRAWING CARRIES ITS OWN FONTS. An `<img>` of an SVG cannot reach
 * the page's web fonts: without this, its text renders in whatever the
 * reader's machine resolves the stack to, and a layout measured in Inter is
 * filled with another face. So before a harvested drawing is stored, the
 * document's bundled faces it is drawn in (the story font manifest, served
 * from public/fonts) are embedded in it: each subset to exactly the drawing's
 * characters and pinned to the weights it draws, as `data:font/woff2` in ONE
 * leading stylesheet, with `text-rendering: geometricPrecision` so every
 * platform lays that text out at the unhinted advances the harvest measured
 * (components/kit/mermaid). The drawing is then the same picture everywhere,
 * and a reader shows it as it is.
 *
 * A drawing in a face the app does not bundle (a system stack, a character no
 * bundled face covers) cannot carry it: `embedMermaidFonts` answers null and
 * nothing is stored — its readers draw with the engine, as before.
 *
 * The block is the ONLY place a stored drawing may name a font file, and only
 * as this module writes it (lib/mermaid-images/sanitize verifyEmbeddedMermaidSvg):
 * family names from the manifest, bytes from our own files.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import wawoff2 from 'wawoff2';
import fontManifest from '@/lib/data/story/story-font-manifest.json';
import type { MermaidFaces } from './drawn';

interface ManifestFace { family: string; url: string; weight: string; style?: string | null; unicodeRange?: string | null }
const FAMILIES = (fontManifest as { families: Record<string, ManifestFace[]> }).families;

/** The families a stored drawing may carry: the bundled ones. */
export const MERMAID_BUNDLED_FAMILIES: ReadonlySet<string> = new Set(Object.keys(FAMILIES));
/** Every stored drawing lays its text out unhinted, as the harvest measured it. */
export const MERMAID_TEXT_RENDERING = 'svg{text-rendering:geometricPrecision}';
/** The block, wherever it sits (the gate that admits it is lib/mermaid-images/sanitize). */
export const MERMAID_FONT_BLOCK = /<style>(?:@font-face\{[^}]*\})+svg\{text-rendering:geometricPrecision\}<\/style>/;

/*
 * THE SUBSETTER: HarfBuzz's hb-subset (harfbuzzjs) and Google's woff2
 * (wawoff2), both WebAssembly, both left out of the server bundle
 * (scripts/runtime-externals): each reads its own files beside its module.
 */
interface HarfBuzz {
  memory: WebAssembly.Memory;
  malloc(size: number): number; free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void; hb_blob_get_data(blob: number, length: number): number; hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number; hb_face_destroy(face: number): void; hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number; hb_subset_input_destroy(input: number): void;
  hb_subset_input_set(input: number, which: number): number; hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_pin_axis_location(input: number, face: number, tag: number, value: number): number;
  hb_subset_or_fail(face: number, input: number): number;
  hb_set_add(set: number, value: number): void; hb_set_clear(set: number): void; hb_set_invert(set: number): void;
}
let harfbuzz: Promise<HarfBuzz> | null = null;
function loadHarfBuzz(): Promise<HarfBuzz> {
  harfbuzz ??= (async () => {
    const bytes = await readFile(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'));
    const { instance } = await WebAssembly.instantiate(bytes);
    const exports = instance.exports as unknown as HarfBuzz & { _initialize(): void };
    exports._initialize();
    return exports;
  })();
  return harfbuzz;
}
const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
const tag = (name: string) => [...name].reduce((value, ch) => (value << 8) + ch.charCodeAt(0), 0);

/** One face (TrueType/OpenType bytes) cut to these characters, at this weight when it varies; woff2 out. */
async function subset(sfnt: Uint8Array, characters: string, weight: number | null): Promise<Buffer> {
  const hb = await loadHarfBuzz();
  const heap = () => new Uint8Array(hb.memory.buffer);
  const input = hb.hb_subset_input_create_or_fail();
  if (!input) throw new Error('hb_subset_input_create_or_fail');
  const buffer = hb.malloc(sfnt.byteLength);
  heap().set(sfnt, buffer);
  const blob = hb.hb_blob_create(buffer, sfnt.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  try {
    // Every layout feature (kerning, contextual forms): the text must shape as the harvest shaped it.
    const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
    hb.hb_set_clear(features);
    hb.hb_set_invert(features);
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const ch of characters) hb.hb_set_add(unicodes, ch.codePointAt(0)!);
    if (weight !== null && !hb.hb_subset_input_pin_axis_location(input, face, tag('wght'), weight)) throw new Error(`cannot pin wght=${weight}`);
    const cut = hb.hb_subset_or_fail(face, input);
    if (!cut) throw new Error('hb_subset_or_fail');
    const result = hb.hb_face_reference_blob(cut);
    const bytes = heap().slice(hb.hb_blob_get_data(result, 0), hb.hb_blob_get_data(result, 0) + hb.hb_blob_get_length(result));
    hb.hb_blob_destroy(result);
    hb.hb_face_destroy(cut);
    return Buffer.from(await wawoff2.compress(bytes));
  } finally {
    hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(buffer);
  }
}

const sfnts = new Map<string, Promise<Uint8Array>>();
/** A bundled face file, decompressed once per process. */
function sfntOf(url: string): Promise<Uint8Array> {
  let found = sfnts.get(url);
  if (!found) {
    // public/fonts, beside the app (server/app serves the same directory; lib/offline reads it too).
    found = readFile(path.join(path.resolve('public'), 'fonts', path.basename(url)))
      // A copy: wawoff2 answers a view of its own heap, which its next call reuses.
      .then(async (woff2) => new Uint8Array(await wawoff2.decompress(woff2)));
    found.catch(() => sfnts.delete(url));
    sfnts.set(url, found);
  }
  return found;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) =>
  name[0] === '#' ? String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))) : ENTITIES[name] ?? entity);

/** The drawing's rendered text: in edge labels (the edge-label face) and everywhere else (the label face). */
function textOf(svg: string): { label: string; edge: string } {
  const text = { label: '', edge: '' };
  const stack: Array<{ edge: boolean; hidden: boolean }> = [];
  for (const match of svg.matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, name, attributes, selfClosing, chars] = match;
    const top = stack[stack.length - 1];
    if (chars !== undefined) {
      if (top && !top.hidden) text[top.edge ? 'edge' : 'label'] += decode(chars);
    } else if (closing) stack.pop();
    else if (!selfClosing) {
      const edge = (top?.edge ?? false) || /\bclass\s*=\s*"[^"]*\bedgeLabel\b/.test(attributes ?? '');
      stack.push({ edge, hidden: (top?.hidden ?? false) || /^(style|title|desc)$/i.test(name!) });
    }
  }
  return text;
}

/** The first family of every font stack the drawing declares (its own CSS and attributes). */
function namedFamilies(svg: string): Set<string> {
  const named = new Set<string>();
  // `font-family` itself, never a custom property that ends in it (Mermaid's own `--mermaid-font-family`).
  for (const match of svg.matchAll(/(?<![\w-])font-family\s*(?::|=\s*")\s*([^;}"]*(?:&quot;|"[^"]*")?[^;}"]*)/gi)) {
    const first = decode(match[1] ?? '').split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    if (first) named.add(first);
  }
  return named;
}

const WEIGHTS: Record<string, number> = { normal: 400, bold: 700, bolder: 700, lighter: 300 };
/** The weights the drawing's text is set in: 400, and whatever bold it asks for. */
function weightsOf(svg: string): number[] {
  const weights = new Set([400]);
  for (const match of svg.matchAll(/font-weight\s*[:=]\s*"?\s*([a-z]+|\d{3})/gi)) {
    const weight = WEIGHTS[match[1]!.toLowerCase()] ?? Number(match[1]);
    if (weight >= 100 && weight <= 900) weights.add(weight);
  }
  return [...weights].sort((a, b) => a - b);
}

function inRange(range: string | null | undefined, point: number): boolean {
  return (range || 'U+0-10FFFF').split(',').some((part) => {
    const match = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!match) return false;
    const low = Number.parseInt(match[1]!.replace(/\?/g, '0'), 16);
    const high = Number.parseInt(match[2] ?? match[1]!.replace(/\?/g, 'f'), 16);
    return point >= low && point <= high;
  });
}

/** One family's `@font-face` rules for these characters at these weights; null when it cannot cover them. */
async function rulesFor(family: string, characters: string, weights: number[]): Promise<string[] | null> {
  const faces = (FAMILIES[family] ?? []).filter((face) => (face.style ?? 'normal') === 'normal');
  const points = [...new Set(characters)].filter((ch) => ch.trim()).map((ch) => ch.codePointAt(0)!);
  if (!faces.length || points.some((point) => !faces.some((face) => inRange(face.unicodeRange, point)))) return null;
  const byFile = new Map<string, ManifestFace[]>();
  for (const face of faces) byFile.set(face.url, [...(byFile.get(face.url) ?? []), face]);
  const rules: string[] = [];
  for (const [url, declared] of byFile) {
    const first = declared[0]!;
    const cut = [...new Set(characters)].filter((ch) => inRange(first.unicodeRange, ch.codePointAt(0)!)).join('');
    if (!cut.trim()) continue;
    // A variable file (a weight range, or one file declared at several weights) is pinned to each weight drawn;
    // a static one is carried as the weights it has (a bold it lacks is synthesized, as in the page).
    const variable = declared.length > 1 || /\s/.test(first.weight.trim());
    const instances = variable ? weights : [...new Set(declared.map((face) => Number.parseInt(face.weight, 10)))];
    const sfnt = await sfntOf(url);
    for (const weight of instances) {
      const woff2 = await subset(sfnt, cut, variable ? weight : null);
      rules.push(`@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${woff2.toString('base64')}) format("woff2");font-weight:${weight};font-style:normal${first.unicodeRange ? `;unicode-range:${first.unicodeRange}` : ''}}`);
    }
  }
  return rules;
}

/**
 * The drawing carrying the faces it is drawn in, as one leading stylesheet;
 * null when a face it draws text in is not a bundled one. The rest of the
 * drawing is byte for byte what the engine drew.
 */
export async function embedMermaidFonts(svg: string, faces: MermaidFaces): Promise<string | null> {
  const open = /^<svg\b[^>]*>/.exec(svg);
  if (!open) return null;
  const text = textOf(svg);
  const named = namedFamilies(svg);
  // Every stack it declares must lead with a face it can carry: one that leads with a system face
  // (C4's "Open Sans", gitGraph's "trebuchet ms") sets text that renders per machine.
  if ([...named].some((family) => !MERMAID_BUNDLED_FAMILIES.has(family))) return null;
  const labelText = text.label.trim() ? text.label : '';
  const edgeText = text.edge.trim() ? text.edge : '';
  const wanted = new Map<string, { characters: string; weights: Set<number> }>();
  const want = (family: string, characters: string, weights: number[]) => {
    const entry = wanted.get(family) ?? { characters: '', weights: new Set<number>() };
    entry.characters += characters;
    for (const weight of weights) entry.weights.add(weight);
    wanted.set(family, entry);
  };
  if (labelText) {
    // The label face is the one Mermaid sets on the drawing's root (`#<id>{font-family:…}`); a kind
    // that sets none (wardley) leaves its text to each machine's default face.
    const id = /\bid="([\w-]+)"/.exec(open[0])?.[1];
    const rule = id ? `#${id}{font-family:` : null;
    const at = rule ? svg.indexOf(rule) : -1;
    const root = at >= 0 && decode(svg.slice(at + rule!.length, at + rule!.length + 200)).split(/[,;}]/)[0]!.trim().replace(/^["']|["']$/g, '') === faces.label;
    if (!MERMAID_BUNDLED_FAMILIES.has(faces.label) || !root) return null;
    want(faces.label, labelText, weightsOf(svg));
  }
  if (edgeText) {
    if (!MERMAID_BUNDLED_FAMILIES.has(faces.edge) || !named.has(faces.edge)) return null;
    want(faces.edge, edgeText, [400]);
  }
  const rules: string[] = [];
  for (const [family, { characters, weights }] of wanted) {
    const made = await rulesFor(family, characters, [...weights].sort((a, b) => a - b));
    if (!made) return null;
    rules.push(...made);
  }
  if (!rules.length) return null;
  return `${open[0]}<style>${rules.join('')}${MERMAID_TEXT_RENDERING}</style>${svg.slice(open[0].length)}`;
}
