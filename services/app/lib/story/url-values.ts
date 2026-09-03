/**
 * THE READER'S `<Value>` CHOICES, CARRIED IN THE LINK — `?$season=2024-25&$team=LAL`.
 *
 * A dashboard's whole point is that the reader narrows it; the link they then
 * copy has to be the document they were looking at. This module is the ONLY
 * place a URL becomes typed scalars and the only place scalars become a URL,
 * so the server's seed, the runtime's write-back and the capture all speak one
 * grammar.
 *
 * Why `$name` and not a bare name: it is the document's OWN binding syntax
 * (`value="$season"`, `$season` inside SQL — lib/story/dataflow), so a reader
 * who sees the address bar sees the thing the author declared; and it cannot
 * collide with the keys the server itself reads on `/a/<id>` (`key`, `chrome`,
 * `edit`, `comment`, `v`), none of which may ever be shadowed by a Value name.
 *
 * Three rules the tests pin, each of them a link that must not break:
 *  - a MALFORMED link never throws and never blanks a document. An undeclared
 *    name, a table Value, a value that is not of the declared type, even bytes
 *    that are not valid percent-encoding — all are simply not there, and the
 *    document falls back to what its author declared.
 *  - the EMPTY value is null, which is how "All" is spelled everywhere else in
 *    the dataflow (`$x is null or x = $x`). `?$team=` means "every team", and
 *    is different from `$team` being absent, which means the default.
 *  - only NON-DEFAULT values are written. A link with no `$` params in it is a
 *    document at rest, so sharing the defaults produces the plain address —
 *    and every param that is not ours survives the round trip untouched.
 */
import { coerceScalarInput, scalarMatches, type Dataflow, type Scalar, type ScalarValueDecl } from './dataflow';

/**
 * A `$` param, judged from the RAW key so a value that will not decode cannot
 * change the answer. `%24` is here because some tools encode the dollar before
 * anyone sees it.
 */
const DOLLAR_KEY_RE = /^(\$|%24)/i;

/** One `key=value` pair as it appeared, plus its decoded halves when they decode. */
interface RawPair {
  /** Exactly the bytes between the `&`s — what a preserved param is re-emitted as. */
  raw: string;
  /** True when this pair is a `$` param (ours), by its raw key. */
  ours: boolean;
  /** The Value name, when the key is ours AND decodes. */
  name: string | null;
  /** The decoded value, when it decodes. */
  value: string | null;
}

/** `+` is a space in a query string; anything that will not decode is `null`. */
function decode(part: string): string | null {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * Split a search string into pairs WITHOUT `URLSearchParams`, which is lenient
 * where we must not be: it decodes `%E2` to U+FFFD, so a truncated link would
 * silently become a real (wrong) selection rather than no selection at all.
 */
function pairsOf(search: string): RawPair[] {
  const query = search.replace(/^[?]/, '');
  if (!query) return [];
  const out: RawPair[] = [];
  for (const raw of query.split('&')) {
    if (!raw) continue;
    const eq = raw.indexOf('=');
    const rawKey = eq < 0 ? raw : raw.slice(0, eq);
    const rawValue = eq < 0 ? '' : raw.slice(eq + 1);
    const ours = DOLLAR_KEY_RE.test(rawKey);
    const key = ours ? decode(rawKey) : null;
    out.push({
      raw,
      ours,
      name: key && key.startsWith('$') ? key.slice(1) : null,
      value: ours ? decode(rawValue) : null,
    });
  }
  return out;
}

/** The document's scalar declarations by name — tables are never settable from a link. */
const scalarsOf = (flow: Dataflow): Map<string, ScalarValueDecl> =>
  new Map(flow.values.filter((v): v is ScalarValueDecl => v.kind === 'scalar').map((v) => [v.name, v]));

/**
 * One URL string against one declaration. `null` means "the link said nothing
 * usable about this value" — the caller then leaves the declared default
 * alone, which is the fallback the whole module is built around.
 */
function scalarFromUrl(decl: ScalarValueDecl, raw: string): { value: Scalar } | null {
  // The empty value is the reader's "All", not a missing one.
  if (raw === '') return { value: null };
  // A boolean is the one type whose coercion cannot fail by itself
  // (`raw === 'true'`), so "maybe" would arrive as a confident `false`.
  if (decl.type === 'boolean' && raw !== 'true' && raw !== 'false') return null;
  const value = coerceScalarInput(decl.type, raw);
  // Non-empty in, null out = the coercion gave up (a number that is not one).
  if (value === null) return null;
  if (!scalarMatches(value, decl.type)) return null;
  return { value };
}

/**
 * The reader's selections as the link states them: declared scalars only,
 * coerced and validated per declaration, everything else dropped in silence.
 * Names the link does not mention are absent, so the caller's own defaults win.
 */
export function readUrlValues(search: string, flow: Dataflow): Record<string, Scalar> {
  const scalars = scalarsOf(flow);
  const out: Record<string, Scalar> = {};
  for (const pair of pairsOf(search)) {
    if (!pair.ours || pair.name === null || pair.value === null) continue;
    const decl = scalars.get(pair.name);
    if (!decl) continue; // undeclared, or a table Value: not settable
    const read = scalarFromUrl(decl, pair.value);
    if (read) out[pair.name] = read.value;
  }
  return out;
}

/**
 * WHAT THE LINK SHOULD SAY about each Value, as a `$`-less map of name → the
 * param's text, or `null` for "there should be no param".
 *
 * This is the one decision, made once, because it has three consumers that
 * must never disagree: `writeUrlValues` below, the frozen `__mxValues`
 * capability in the served document's history prelude (which deletes on null
 * and sets on a string), and the `mx:values` message the framed document sends
 * its page. In particular the reader's explicit "All" is an EMPTY param and
 * not a deletion — deleting it would restore a non-null default on the next
 * read, which is the opposite of what they picked.
 */
export function urlValueParams(flow: Dataflow, values: Record<string, Scalar>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const decl of scalarsOf(flow).values()) {
    if (!Object.prototype.hasOwnProperty.call(values, decl.name)) { out[decl.name] = null; continue; }
    const value = values[decl.name];
    // A document at its default is a document at rest: no param at all, so the
    // shared address is the plain one.
    if (Object.is(value, decl.default)) { out[decl.name] = null; continue; }
    if (value === null) { out[decl.name] = ''; continue; }
    // Anything that is not a scalar was never ours to write (a table's rows
    // reaching this map is a caller bug, not a link).
    if (typeof value === 'object') { out[decl.name] = null; continue; }
    out[decl.name] = String(value);
  }
  return out;
}

/** Encode a query component, keeping `$` literal — it is legal there, and the
 * point of the feature is a link a person can read. */
const enc = (s: string): string => encodeURIComponent(s).replace(/%24/g, '$');

/**
 * `search` with our `$` params replaced by what `values` says, and every other
 * param preserved EXACTLY as it arrived (re-encoding somebody else's parameter
 * is how a signed one stops verifying). Returns `''` — not `'?'` — when
 * nothing is left, so a document at rest has a clean address.
 *
 * `$` params are emitted in DECLARATION order, not in the order the caller's
 * map happens to enumerate: the string has to be stable, or every re-render
 * looks like a change and the address bar thrashes.
 */
export function writeUrlValues(search: string, flow: Dataflow, values: Record<string, Scalar>): string {
  const kept = pairsOf(search).filter((p) => !p.ours).map((p) => p.raw);
  const params = urlValueParams(flow, values);
  const mine: string[] = [];
  for (const decl of scalarsOf(flow).values()) {
    const text = params[decl.name];
    if (text === null || text === undefined) continue;
    mine.push(`${enc(`$${decl.name}`)}=${enc(text)}`);
  }
  const query = [...kept, ...mine].join('&');
  return query ? `?${query}` : '';
}

/**
 * Just the `$` params of a search string, in a canonical order — the SELECTION
 * as an opaque token, for a caller that has no flow to validate it against.
 *
 * The exporter is that caller: it forwards a link's selection to the page it
 * photographs (where the raw route validates it, exactly once) and needs a
 * stable string to segment its render CACHE by. Version-keyed caching is what
 * makes one shot serve every unfurl, and it is also what would have served the
 * DEFAULT picture for every selection — the same URL, so the same key.
 * Ordering is by raw key so two links naming the same picks share a shot.
 */
export function urlValuesSearch(search: string): string {
  return pairsOf(search)
    .filter((p) => p.ours)
    .map((p) => p.raw)
    .sort()
    .join('&');
}
