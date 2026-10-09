/**
 * WHICH FONT FILES A MERMAID DRAWING NEEDS TO CARRY — pure, shared by the
 * harvest (lib/mermaid-images/fonts: subsets of the bundled files) and the
 * kit's engine path in the browser (lib/mermaid-images/mermaid-fonts: the files
 * the page already loaded). Both carry the same faces for the same drawing.
 *
 * A drawing can carry its fonts only when every face it sets text in is one
 * the document ships: every font stack it declares leads with a shipped
 * family, the label face is the one on its root, and each face covers its
 * characters AT the weights it draws them in. A weight a face does not ship
 * would be synthesized, and engines synthesize it at different strengths
 * (measured on Noto Serif, bold ink over regular: Chromium +55%, WebKit +20%,
 * Firefox +17%), so such a drawing carries nothing and draws as before.
 */

/**
 * Every drawing that carries its fonts lays that text out unhinted: a stored
 * one as the harvest measured it, a reader's own as a stored one renders.
 */
export const MERMAID_TEXT_RENDERING = 'svg{text-rendering:geometricPrecision}';

/** A face file as a document declares it: `weight` is a number or a `min max` range. */
export interface FontFile { url: string; weight: string; unicodeRange?: string | null }
/** One file to carry: at these weights (instances of a variable file; the declared weight of a static one). */
export interface FontPlanEntry { family: string; url: string; variable: boolean; weights: number[]; unicodeRange: string | null; characters: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) =>
  name[0] === '#' ? String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))) : ENTITIES[name] ?? entity);

/** The drawing's rendered text: in edge labels (the edge-label face) and everywhere else (the label face). */
function textOf(svg: string): { label: string; edge: string } {
  const text = { label: '', edge: '' };
  const stack: Array<{ edge: boolean; hidden: boolean }> = [];
  for (const match of svg.matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, name, attributes, selfClosing, chars] = match;
    const top = stack[stack.length - 1];
    if (chars !== undefined) {
      if (top && !top.hidden) text[top.edge ? 'edge' : 'label'] += decodeEntities(chars);
    } else if (closing) stack.pop();
    else if (!selfClosing) {
      const edge = (top?.edge ?? false) || /\bclass\s*=\s*"[^"]*\bedgeLabel\b/.test(attributes ?? '');
      stack.push({ edge, hidden: (top?.hidden ?? false) || /^(style|title|desc)$/i.test(name!) });
    }
  }
  return text;
}

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '');

/** The first family of every font stack the drawing declares (its own CSS and attributes). */
function namedFamilies(svg: string): Set<string> {
  const named = new Set<string>();
  // `font-family` itself, never a custom property that ends in it (Mermaid's own `--mermaid-font-family`).
  for (const match of svg.matchAll(/(?<![\w-])font-family\s*(?::|=\s*")\s*([^;}"]*(?:&quot;|"[^"]*")?[^;}"]*)/gi)) {
    const first = unquote(decodeEntities(match[1] ?? '').split(',')[0]!);
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

function inUnicodeRange(range: string | null | undefined, point: number): boolean {
  return (range || 'U+0-10FFFF').split(',').some((part) => {
    const match = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!match) return false;
    const low = Number.parseInt(match[1]!.replace(/\?/g, '0'), 16);
    const high = Number.parseInt(match[2] ?? match[1]!.replace(/\?/g, 'f'), 16);
    return point >= low && point <= high;
  });
}

/** The family Mermaid sets on the drawing's root rule (`#<id>{font-family:…}`), or null (wardley sets none). */
function rootFamily(svg: string): string | null {
  const id = /^<svg\b[^>]*\bid="([\w-]+)"/.exec(svg)?.[1];
  if (!id) return null;
  const rule = `#${id}{font-family:`;
  const at = svg.indexOf(rule);
  return at < 0 ? null : unquote(decodeEntities(svg.slice(at + rule.length, at + rule.length + 200)).split(/[,;}]/)[0]!);
}

const weightRange = (weight: string): [number, number] => {
  const [low, high] = weight.trim().split(/\s+/).map((part) => Number.parseInt(part, 10));
  return [low ?? 400, high ?? low ?? 400];
};

/**
 * The files this drawing must carry, given the files each family ships; null
 * when it cannot carry them all (see the module comment).
 */
export function planFontFiles(svg: string, faces: { label: string; edge: string }, shipped: (family: string) => FontFile[]): FontPlanEntry[] | null {
  const text = textOf(svg);
  if ([...namedFamilies(svg)].some((family) => !shipped(family).length)) return null;
  const wanted = new Map<string, { characters: string; weights: Set<number> }>();
  const want = (family: string, characters: string, weights: number[]) => {
    const entry = wanted.get(family) ?? { characters: '', weights: new Set<number>() };
    entry.characters += characters;
    for (const weight of weights) entry.weights.add(weight);
    wanted.set(family, entry);
  };
  if (text.label.trim()) {
    if (rootFamily(svg) !== faces.label || !shipped(faces.label).length) return null;
    want(faces.label, text.label, weightsOf(svg));
  }
  if (text.edge.trim()) {
    if (!namedFamilies(svg).has(faces.edge) || !shipped(faces.edge).length) return null;
    want(faces.edge, text.edge, [400]);
  }
  const plan: FontPlanEntry[] = [];
  for (const [family, { characters, weights }] of wanted) {
    const files = shipped(family);
    const points = [...new Set(characters)].filter((ch) => ch.trim()).map((ch) => ch.codePointAt(0)!);
    if (points.some((point) => !files.some((file) => inUnicodeRange(file.unicodeRange, point)))) return null;
    const byUrl = new Map<string, FontFile[]>();
    for (const file of files) byUrl.set(file.url, [...(byUrl.get(file.url) ?? []), file]);
    for (const [url, declared] of byUrl) {
      const first = declared[0]!;
      const cut = [...new Set(characters)].filter((ch) => inUnicodeRange(first.unicodeRange, ch.codePointAt(0)!)).join('');
      if (!cut.trim()) continue;
      const covers = (weight: number) => declared.some((file) => { const [low, high] = weightRange(file.weight); return weight >= low && weight <= high; });
      // Every weight drawn must be one this file ships: no synthesized bold.
      if ([...weights].some((weight) => !covers(weight))) return null;
      const variable = declared.length > 1 || /\s/.test(first.weight.trim());
      plan.push({ family, url, variable, weights: variable ? [...weights].sort((a, b) => a - b) : [weightRange(first.weight)[0]], unicodeRange: first.unicodeRange ?? null, characters: cut });
    }
  }
  return plan.length ? plan : null;
}
