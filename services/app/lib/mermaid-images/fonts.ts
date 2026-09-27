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
import type { MermaidFaces } from './drawn';
import { MERMAID_TEXT_RENDERING, bundledFontFiles } from './font-block';
import { planFontFiles, type FontPlanEntry } from './svg-text';

export { MERMAID_BUNDLED_FAMILIES, MERMAID_FONT_BLOCK, MERMAID_TEXT_RENDERING } from './font-block';

/** The subsetter's WebAssembly (harfbuzzjs, wawoff2) could not be loaded: nothing can be embedded now. */
export class MermaidSubsetterUnavailable extends Error {}

/*
 * THE SUBSETTER: HarfBuzz's hb-subset (harfbuzzjs) and Google's woff2
 * (wawoff2), both WebAssembly, both left out of the server bundle
 * (scripts/runtime-externals): each reads its own files beside its module.
 * Both load on first use, inside a harvest — never at import — so a missing
 * or broken install can only fail harvesting (MermaidSubsetterUnavailable:
 * nothing stored, readers keep the engine), never the app or the read path.
 */
type Woff2 = { compress(sfnt: Uint8Array): Promise<Uint8Array>; decompress(woff2: Uint8Array): Promise<Uint8Array> };
let woff2Module: Promise<Woff2> | null = null;
function loadWoff2(): Promise<Woff2> {
  woff2Module ??= import('wawoff2').then((module) => (module as unknown as { default?: Woff2 }).default ?? (module as unknown as Woff2));
  woff2Module.catch(() => { woff2Module = null; });
  return woff2Module;
}
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
  harfbuzz.catch(() => { harfbuzz = null; });
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
    return Buffer.from(await (await loadWoff2()).compress(bytes));
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
      .then(async (woff2) => new Uint8Array(await (await loadWoff2()).decompress(woff2)));
    found.catch(() => sfnts.delete(url));
    sfnts.set(url, found);
  }
  return found;
}

/**
 * The drawing carrying the faces it is drawn in, as one leading stylesheet;
 * null when a face it draws text in is not a bundled one. The rest of the
 * drawing is byte for byte what the engine drew.
 */
export async function embedMermaidFonts(svg: string, faces: MermaidFaces): Promise<string | null> {
  const open = /^<svg\b[^>]*>/.exec(svg);
  if (!open) return null;
  const plan = planFontFiles(svg, faces, bundledFontFiles);
  if (!plan) return null;
  try {
    await Promise.all([loadHarfBuzz(), loadWoff2()]);
  } catch (error) {
    throw new MermaidSubsetterUnavailable((error as Error).message);
  }
  const rules: string[] = [];
  for (const file of plan) rules.push(...await rulesFor(file));
  return `${open[0]}<style>${rules.join('')}${MERMAID_TEXT_RENDERING}</style>${svg.slice(open[0].length)}`;
}

/** One planned file's `@font-face` rules: subset to its characters, one per weight drawn. */
async function rulesFor(file: FontPlanEntry): Promise<string[]> {
  const sfnt = await sfntOf(file.url);
  const rules: string[] = [];
  for (const weight of file.weights) {
    const woff2 = await subset(sfnt, file.characters, file.variable ? weight : null);
    rules.push(`@font-face{font-family:"${file.family}";src:url(data:font/woff2;base64,${woff2.toString('base64')}) format("woff2");font-weight:${weight};font-style:normal${file.unicodeRange ? `;unicode-range:${file.unicodeRange}` : ''}}`);
  }
  return rules;
}
