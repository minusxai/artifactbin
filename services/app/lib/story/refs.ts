/**
 * The jsx tier's reference graph: ONE uniform syntax — a file
 * reference anywhere in markup is the string `ref:<id>` — extracted
 * from the parsed AST at publish time, resolved against the artifacts the
 * publisher can reach (their own, or any public/unlisted one), and validated
 * bidirectionally:
 *  - data refs must be datasets; recipe refs viz recipes; src refs images
 *  - vega-lite/vega encoding fields are checked against the dataset's columns
 *    (via the ported lib/viz/field-refs collector)
 *  - recipe uses are checked slot-by-slot: every declared slot bound, bound
 *    columns exist and match the slot's `accepts` kinds
 * Dependents warnings on dataset/viz refresh re-run the same checks.
 */
import { parseJsx, type JsxAttribute, type JsxNode, type JsxElement, type ValidationError } from '@/lib/jsx';
import { videoEmbedUrl } from '@/lib/story-ui/video-embed';
import { collectFieldRefs, collectDerivedFieldNames, hasUnverifiableTransform } from '@/lib/viz/field-refs';
import { MUTATION_TAG, QUERY_TAG, parseMutationDecl, parseQueryDecl, refName } from './dataflow';
import type { DatasetColumn } from './data-tiers';
import type { VizRecipeBinding, VizRecipeContent } from '@/lib/validation/atlas-schemas';
import { isNumberFormat, NUMBER_FORMAT_HINT } from './number-format';

export interface RefUse {
  id: string;
  kind: 'dataset' | 'viz' | 'image' | 'pdf';
  /** Datasets are only ever reached as `ref_<id>` tables inside a <Query>'s or <Mutation>'s SQL. */
  via?: 'sql';
  /**
   * The use WRITES the dataset (a `<Mutation>` target). Reads resolve by the
   * link-readable rule; a write needs the target OWNED and `readwrite`.
   */
  write?: boolean;
  /** For recipe binding validation: the viz envelope + `data` ref carried by the same element. */
  element?: { viz?: Record<string, unknown> | null; dataRef?: string | null };
}

/** A dataset's write ACL (lib/artifacts DatasetAccess, mirrored here so this module stays DB-free). */
export type RefAccess = 'read' | 'readwrite';

export interface ResolvedRef {
  id: string;
  format: string;
  /** dataset: parsed columns; viz: parsed recipe. */
  columns?: DatasetColumn[];
  recipe?: VizRecipeContent;
  /** dataset: its write ACL. */
  access?: RefAccess;
  /**
   * Resolved through the caller's OWN scope (their token or account), not the
   * link-readable fallback. A write is admitted only when this is true.
   */
  owned?: boolean;
}

export type RefLoader = (id: string) => Promise<ResolvedRef | null>;

const REF_RE = /^ref:([A-Za-z0-9_-]+)$/;

export function refId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = REF_RE.exec(value);
  return m ? m[1] : null;
}

function walk(nodes: JsxNode[], visit: (el: JsxElement) => void): void {
  for (const n of nodes) {
    if (n.type !== 'element') continue;
    visit(n);
    walk(n.children, visit);
  }
}

const attrValue = (el: JsxElement, name: string): unknown => {
  const v = el.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value;
  return v && v.static ? v.json : undefined;
};

/** Collect every `ref:` use in a jsx source, with enough element context for binding checks. */
export function collectRefUses(source: string): RefUse[] | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const uses: RefUse[] = [];
  walk(parsed.nodes, (el) => {
    const tag = el.tag;
    // A <Query> reads datasets as `ref_<id>` tables (lib/story/dataflow.ts) —
    // the ONLY way a document reaches a dataset now. Real refs: they resolve
    // through the loader like any other and land in meta.refs (dependents
    // warnings), but their rows go through the engine, never onto the page.
    if (el.isComponent && tag === QUERY_TAG) {
      const q = parseQueryDecl(el);
      if (q.ok) for (const id of q.decl.refs) uses.push({ id, kind: 'dataset', via: 'sql' });
      return;
    }
    // A <Mutation> WRITES its one dataset: the same ref (ownership, dependents,
    // meta.refs) with the stricter admission below.
    if (el.isComponent && tag === MUTATION_TAG) {
      const m = parseMutationDecl(el);
      if (m.ok) uses.push({ id: m.decl.target, kind: 'dataset', via: 'sql', write: true });
      return;
    }
    const data = attrValue(el, 'data');
    const viz = attrValue(el, 'viz') as Record<string, unknown> | undefined;
    const recipeRef = viz ? refId(viz.recipe) : null;
    if (recipeRef) uses.push({ id: recipeRef, kind: 'viz', element: { viz: viz ?? null, dataRef: typeof data === 'string' ? data : null } });
    // URL attrs: src (images). href stays same-origin-URL-only for now.
    const srcRef = refId(attrValue(el, 'src'));
    if (srcRef && tag.toLowerCase() === 'img') uses.push({ id: srcRef, kind: 'image' });
    // <Video poster> is the card's thumbnail — hosted, like every image.
    const posterRef = refId(attrValue(el, 'poster'));
    if (posterRef && el.isComponent && tag === 'Video') uses.push({ id: posterRef, kind: 'image' });
    // <File src> is the ONE position that names a PDF: a card that links it.
    if (srcRef && el.isComponent && tag === 'File') uses.push({ id: srcRef, kind: 'pdf' });
  });
  return uses;
}

/**
 * Attributes the BROWSER fetches on its own. `href` is deliberately absent: a
 * link is navigation the reader chooses, not a subresource the page pulls.
 */
const SUBRESOURCE_ATTRS = new Set(['src', 'poster', 'background']);
/** Same, but the value is a comma-separated list ("url descriptor, …"). */
const SUBRESOURCE_LIST_ATTRS = new Set(['srcset', 'ping']);

/** Self-contained sources: one of the owner's artifacts, or bytes inlined here. */
const isSelfContained = (url: string): boolean =>
  refId(url) !== null || /^data:image\//i.test(url.replace(/[\x00-\x20]/g, '')); // eslint-disable-line no-control-regex -- mirrors browser scheme normalization

/**
 * artifactbin is STRICTER than the ported minusx validator, on purpose: an
 * artifact must be self-contained. The ported gate (lib/jsx/validate) only
 * rejects dangerous SCHEMES, so `https://…` images pass it — correct for
 * minusx (an internal tool serving its own assets), wrong here, where:
 *  - a shared document would phone home with every viewer's IP,
 *  - it breaks the moment that host does, and
 *  - `/a/<id>/export` renders the page in OUR headless browser, so an external
 *    URL becomes a server-side fetch from inside our network.
 *
 * Kept out of lib/jsx/ so the ported engine stays verbatim (parity harness).
 */
export function findExternalSubresources(source: string): ValidationError[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return []; // the JSX gate already reported the parse failure
  const errors: ValidationError[] = [];
  const reject = (url: string, a: JsxAttribute, tag: string) =>
    errors.push({
      message: `External URL "${url}" in "${a.name}" on <${tag}> — artifacts must be self-contained. Publish it as an image artifact and reference it as ref:<id>, or inline it as a data:image/ URL.`,
      attr: a.name,
      tag,
      start: a.start,
      end: a.end,
    });

  walk(parsed.nodes, (el) => {
    for (const a of el.attributes) {
      if (!a.value.static || typeof a.value.json !== 'string' || a.value.json === '') continue;
      const name = a.name.toLowerCase();
      const value = a.value.json;
      if (SUBRESOURCE_LIST_ATTRS.has(name)) {
        for (const entry of value.split(',')) {
          const url = entry.trim().split(/\s+/)[0];
          if (url && !isSelfContained(url)) reject(url, a, el.tag);
        }
      } else if (SUBRESOURCE_ATTRS.has(name) && !isSelfContained(value)) {
        // <Video src> is the ONE sanctioned external subresource: an embed is
        // external by definition, and lib/story-ui/video-embed.ts is its leash
        // (host allowlist, id-constructed URL). Validated here at the door —
        // publishing a player that renders "unsupported source" would tell the
        // author nothing (the findBrokenEmbeds principle below).
        // A WEB URL in an image position is INPUT vocabulary, not a violation:
        // the publish door imports it and rewrites it to `ref:<id>` before the
        // stored document exists (lib/story/external-images). Exempted here so
        // /api/preview — which never ingests — agrees with publish, per the
        // always-on-error-array rule. Every other position stays rejected.
        // The same exemption for a PDF a document links by URL: the publish
        // door imports it under its own cap and the serve-time mapping points
        // the card at our copy. Here rather than only at the import so
        // /api/preview — which fetches nothing — agrees with publish.
        if (/^https?:\/\//i.test(value)
          && ((el.tag.toLowerCase() === 'img' && name === 'src')
            || (el.tag === 'Video' && name === 'poster')
            || (el.tag === 'File' && name === 'src'))) {
          continue;
        }
        if (el.tag === 'Video' && name === 'src') {
          if (videoEmbedUrl(value) === null) {
            errors.push({
              message: `"${value}" in "src" on <Video> is not a supported video source — use a YouTube, Vimeo or Loom link (watch/share URLs are fine; the card opens the video on its own page).`,
              attr: a.name,
              tag: el.tag,
              start: a.start,
              end: a.end,
            });
          }
          continue;
        }
        reject(value, a, el.tag);
      }
    }
  });
  return errors;
}

const KIND_FOR_FORMAT: Record<string, RefUse['kind']> = { dataset: 'dataset', viz: 'viz', image: 'image', pdf: 'pdf' };

const colKind = (t: DatasetColumn['type']): 'quantitative' | 'temporal' | 'nominal' =>
  t === 'number' ? 'quantitative' : t === 'date' ? 'temporal' : 'nominal';

/**
 * Resolve + validate every ref. Returns the deduped ref list for meta.refs, or
 * the error details. Binding checks run when both sides are resolvable.
 */
export async function validateRefs(source: string, load: RefLoader): Promise<
  | { ok: true; refs: Array<{ id: string; kind: RefUse['kind'] }> }
  | { ok: false; details: string[] }
> {
  const uses = collectRefUses(source);
  if (uses === null) return { ok: true, refs: [] }; // unparseable → the jsx validator already rejected
  const details: string[] = [];
  const resolved = new Map<string, ResolvedRef | null>();
  for (const use of uses) {
    if (!resolved.has(use.id)) resolved.set(use.id, await load(use.id));
    const r = resolved.get(use.id) ?? null;
    // Owned or link-readable (public/unlisted) — the loader's rule. One message
    // for "missing" and "private, not yours": naming the difference would be an
    // existence oracle for every id.
    if (!r) { details.push(`ref:${use.id} does not resolve — use one of your own artifact ids, or any public/unlisted one`); continue; }
    const kind = KIND_FOR_FORMAT[r.format];
    if (kind !== use.kind) {
      details.push(`ref:${use.id} is a ${r.format ?? 'unknown'} artifact — this position needs a ${use.kind}`);
      continue;
    }
    // A WRITE is admitted narrower than a read, twice over. The dataset must
    // be the publisher's OWN — the link-readable fallback exists so a document
    // can chart any public dataset, and nothing about "public" says "anyone
    // may append rows to it" — and its owner must have opened it for writes.
    // Both refusals name the fix; neither is an existence oracle (the row was
    // already admitted for reading by the rule above).
    if (use.write) {
      if (!r.owned) {
        details.push(`ref_${use.id} is not yours to write — a <Mutation> may only write a dataset you own (read it with a <Query> instead, or publish your own copy)`);
        continue;
      }
      if (r.access !== 'readwrite') {
        details.push(`ref_${use.id} is read-only — a <Mutation> needs a dataset with access: readwrite (set it on create or PUT, PATCH /api/my/artifacts/${use.id} { "access": "readwrite" }, or from the dataset's share menu)`);
        continue;
      }
    }
  }
  // Recipe slot checks: every declared slot bound. Column checks against the
  // bound table run at the dry run (jsx-tier), where the query's result
  // columns are known.
  for (const use of uses) {
    if (use.kind !== 'viz' || !use.element?.viz) continue;
    const recipe = resolved.get(use.id)?.recipe;
    if (!recipe) continue;
    details.push(...validateRecipeUse(use.element.viz, recipe, null, `ref:${use.id}`));
  }
  if (details.length) return { ok: false, details };
  const seen = new Set<string>();
  const refs: Array<{ id: string; kind: RefUse['kind'] }> = [];
  for (const u of uses) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    refs.push({ id: u.id, kind: u.kind });
  }
  return { ok: true, refs };
}

/**
 * The same encoding check against ANY table's columns — a dataset's, or a
 * `<Query>` result's (its columns come from the publish-time dry run, so a
 * chart bound to `data="$sales"` is checked against what `sales` really
 * yields, exactly as a `ref:` chart is checked against its dataset).
 */
export function validateVizAgainstColumns(viz: Record<string, unknown>, columns: DatasetColumn[], label: string): string[] {
  const kind = viz.kind;
  if (kind !== 'vega-lite' && kind !== 'vega') return [];
  const spec = viz.spec as Record<string, unknown> | undefined;
  if (!spec || typeof spec !== 'object') return [];
  if (hasUnverifiableTransform(spec)) return []; // transforms rewrite fields — skip, same as minusx validate
  const names = new Set(columns.map((c) => c.name));
  const derived = collectDerivedFieldNames(spec);
  const out: string[] = [];
  for (const ref of collectFieldRefs(spec)) {
    if (names.has(ref.field) || derived.has(ref.field)) continue;
    out.push(`encoding field "${ref.field}" is not a column of ${label} (columns: ${columns.map((c) => c.name).join(', ')})`);
  }
  return out;
}

/**
 * recipe use: every declared slot bound; bound columns exist + match accepts.
 * `recipeLabel` names the recipe in diagnostics — `ref:<id>` for a viz
 * artifact, the registry id (`minusx/trend@1`) for a shipped recipe.
 */
export function validateRecipeUse(
  viz: Record<string, unknown>,
  recipe: Pick<VizRecipeContent, 'bindings'>,
  columns: DatasetColumn[] | null,
  recipeLabel: string,
): string[] {
  const out: string[] = [];
  const bindings = (viz.bindings ?? {}) as Record<string, unknown>;
  const slots = (recipe.bindings ?? []) as VizRecipeBinding[];
  for (const slot of slots) {
    const bound = bindings[slot.name];
    if (bound === undefined || bound === null) {
      out.push(`recipe ${recipeLabel} slot "${slot.name}" is not bound`);
      continue;
    }
    const cols = Array.isArray(bound) ? bound : [bound];
    for (const c of cols) {
      if (typeof c !== 'string') { out.push(`recipe ${recipeLabel} slot "${slot.name}" binding must be a column name`); continue; }
      if (!columns) continue; // inline data / unresolved dataset: skip column checks
      const col = columns.find((x) => x.name === c);
      if (!col) {
        out.push(`recipe ${recipeLabel} slot "${slot.name}" binds "${c}" — not a dataset column (columns: ${columns.map((x) => x.name).join(', ')})`);
      } else if (!slot.accepts.includes(colKind(col.type))) {
        out.push(`recipe ${recipeLabel} slot "${slot.name}" accepts ${slot.accepts.join('|')} but "${c}" is ${colKind(col.type)}`);
      }
    }
  }
  for (const name of Object.keys(bindings)) {
    if (!slots.some((s) => s.name === name)) out.push(`recipe ${recipeLabel} has no slot "${name}"`);
  }
  return out;
}

/**
 * Embeds that cannot possibly resolve.
 *
 * ChatGPT published a chart as `<Question source="ref:…" question="…" />`
 * — plausible prop names, and wrong: the adapter reads `data` and `viz`. We
 * accepted it, and the page rendered "data unavailable — the referenced dataset
 * did not resolve". The `ref:` was even valid; nothing was reading it.
 *
 * A publish that cannot render is worse than a rejected one, because the author
 * is told nothing and finds out by looking. So an embed missing the prop that
 * carries its data is a 400 with the correct prop named.
 */
/**
 * The prop that carries an embed's data, and any prop that makes it optional.
 * A <Param> with literal `options` is a static control and needs no dataset —
 * requiring one would reject a legitimate filter (caught by the app-flow gate,
 * which publishes exactly that).
 */
const EMBED_DATA_PROP: Record<string, { required: string; usage: string; table?: boolean }> = {
  Question: { required: 'data', usage: 'Use data="$name" — a <Query> or table <Value> declared in <Helmet> — plus viz={{"kind":"vega-lite","spec":{…}}}', table: true },
  Number: { required: 'data', usage: 'Use data="$name" — a <Query> or table <Value> declared in <Helmet>', table: true },
  DataTable: { required: 'data', usage: 'Use data="$name" — a <Query> or table <Value> declared in <Helmet>', table: true },
  Video: { required: 'src', usage: 'Use src="<YouTube/Vimeo/Loom link>" (+ optionally poster="ref:<image id>" for the thumbnail)' },
  File: { required: 'src', usage: 'Use src="ref:<pdf id>" — the id create_artifact returned for a pdf — or src="<public https link to a .pdf>" (+ optionally title="…")' },
};

/** Every format spec an embed carries that d3 cannot parse: `<Number format>` and `<DataTable columns[].fmt>`. */
function invalidNumberFormats(el: JsxElement): Array<{ attr: string; spec: string; start: number; end: number }> {
  const out: Array<{ attr: string; spec: string; start: number; end: number }> = [];
  for (const a of el.attributes) {
    if (!a.value.static) continue;
    if (el.tag === 'Number' && a.name === 'format' && typeof a.value.json === 'string' && !isNumberFormat(a.value.json)) {
      out.push({ attr: a.name, spec: a.value.json, start: a.start, end: a.end });
    }
    if (el.tag === 'DataTable' && a.name === 'columns' && Array.isArray(a.value.json)) {
      for (const c of a.value.json) {
        const fmt = c && typeof c === 'object' ? (c as { fmt?: unknown }).fmt : undefined;
        if (typeof fmt === 'string' && !isNumberFormat(fmt)) out.push({ attr: a.name, spec: fmt, start: a.start, end: a.end });
      }
    }
  }
  return out;
}

export function findBrokenEmbeds(source: string): ValidationError[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return [];
  const errors: ValidationError[] = [];
  walk(parsed.nodes, (el) => {
    const rule = EMBED_DATA_PROP[el.tag];
    if (!rule) return;
    // A number format spec d3 cannot parse THROWS at render — inside SSR that is a 500 for every
    // render of the document, from a publish that succeeded. Pi wrote format=",0" on production.
    for (const bad of invalidNumberFormats(el)) {
      errors.push({
        message: `<${el.tag} ${bad.attr}=${JSON.stringify(bad.spec)}>: ${JSON.stringify(bad.spec)} is not a number format — write ${NUMBER_FORMAT_HINT}.`,
        tag: el.tag, attr: bad.attr, start: bad.start, end: bad.end,
      });
    }
    const required = rule.required;
    // A KPI tile written the way an agent guesses it — `singleValueConfig` on
    // the element, or inside `viz` without the kind — publishes as a two-row
    // TABLE, which reads as a bug. Name the one shape that works.
    if (el.tag === 'Question') {
      const topLevel = el.attributes.find((a) => a.name === 'singleValueConfig');
      const vizAttr = el.attributes.find((a) => a.name === 'viz');
      const vizJson = vizAttr?.value.static && vizAttr.value.json && typeof vizAttr.value.json === 'object' && !Array.isArray(vizAttr.value.json)
        ? (vizAttr.value.json as Record<string, unknown>) : null;
      const inVizWithoutKind = vizJson && 'singleValueConfig' in vizJson && vizJson.kind !== 'single_value';
      if (topLevel || inVizWithoutKind) {
        const at = topLevel ?? vizAttr!;
        errors.push({
          message: '<Question> KPI tile: singleValueConfig lives INSIDE viz with kind "single_value" — '
            + 'viz={{"kind":"single_value","yCols":["<numeric column>"],"singleValueConfig":{"label":"…","prefix":"$","suffix":"","format":",.0f"}}} '
            + '(the column is summed over the table\'s rows; format is a d3-format spec). Written any other way it renders as a table.',
          tag: el.tag, attr: at.name, start: at.start, end: at.end,
        });
        return;
      }
      // The vega-lite SPEC written where the ENVELOPE belongs. Measured on the
      // CI smoke run: OpenCode published `viz={{"mark":"line","encoding":{…}}}`,
      // got a 200, and the chart drew nothing — `vizPropToEnvelope` reads
      // `prop.spec`, finds none, and renders blank. Same failure this whole
      // check exists to prevent ("an embed with no data prop publishes fine and
      // renders empty"), one level in.
      //
      // A top-level `mark` or `encoding` with no `spec` cannot be a valid
      // envelope, which makes this unambiguous. Refusing an unknown `kind` is
      // deliberately NOT done here: there is no closed set to check against,
      // and a guessed list would reject documents that render today.
      const bareSpec = vizJson && !('spec' in vizJson) && ('mark' in vizJson || 'encoding' in vizJson);
      if (bareSpec) {
        errors.push({
          message: '<Question viz={…}> is the ENVELOPE, not the spec: a top-level "mark"/"encoding" renders a blank chart. '
            + 'Wrap it — viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{…}}}}.',
          tag: el.tag, attr: vizAttr!.name, start: vizAttr!.start, end: vizAttr!.end,
        });
        return;
      }
    }
    const attr = el.attributes.find((a) => a.name.toLowerCase() === required);
    if (attr) {
      // Present, but not a table reference: `data="ref:<id>"` (the retired
      // direct binding — a dataset is read through a <Query> now) or an
      // inline array. Both render nothing, so both are refused by name.
      if (!rule.table || (attr.value.static && refName(attr.value.json))) return;
      const json = attr.value.static ? attr.value.json : undefined;
      const got = attr.value.static ? JSON.stringify(json) : attr.value.exprType;
      errors.push({
        message: `<${el.tag} data=${got.length > 40 ? got.slice(0, 40) + '…' : got}> does not name a declared table. ${rule.usage}` +
          (typeof json === 'string' && json.startsWith('ref:')
            ? ` — a dataset is read through SQL: <Query name="rows">{\`select * from ref_${json.slice(4)}\`}</Query>, then data="$rows".`
            : '.'),
        tag: el.tag, attr: attr.name, start: attr.start, end: attr.end,
      });
      return;
    }
    const names = new Set(el.attributes.map((a) => a.name.toLowerCase()));
    // Name what they used, so the fix is obvious rather than a guess.
    const used = [...names].filter((n) => n !== 'title' && n !== 'height' && n !== 'classname');
    errors.push({
      message:
        `<${el.tag}> has no "${required}" prop, so nothing resolves and the embed renders empty. ` +
        rule.usage +
        (used.length ? `. Found: ${used.join(', ')}.` : '.'),
      tag: el.tag,
      start: el.start,
      end: el.end,
    });
  });
  return errors;
}
