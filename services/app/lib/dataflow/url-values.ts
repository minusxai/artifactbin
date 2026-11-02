/** Carry native reader query values without changing unrelated URL bytes. */
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

/**
 * The document's LINK-CARRIED scalar declarations by name. Tables are never
 * settable from a link, and neither is a scalar the author kept out of it with
 * `url={false}` — a form draft or a script flag. Excluding them HERE, in the
 * one map all three doors read, is what makes the opt-out symmetric: nothing
 * reads such a name from an address (a stale or hand-made link cannot set it),
 * nothing writes one to it, and `urlSelection` — export and cache keying —
 * sees the same document at rest.
 */
export function withUrlValuesOf(search: string, values: string): string {
  const query = [...pairsOf(search).filter((p) => !p.ours), ...pairsOf(values).filter((p) => p.ours)].map((p) => p.raw).join('&');
  return query ? `?${query}` : '';
}
