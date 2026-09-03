/**
 * `?intent=` — ONE instruction carried on the artifact's own address, consumed
 * on mount and then removed.
 *
 * It exists because two doors lead AWAY from a document and have to lead back
 * INTO it doing the thing that was asked: "fork this" and "log in to comment"
 * both go through /login, and a person who comes back to a document that has
 * simply forgotten what they pressed has been made to do the work twice.
 *
 * Three rules, and they are the whole module:
 *  - a STRICT ALLOWLIST. `fork | comment` and nothing else; an unknown value
 *    is not an error, it is silence — this parameter is on a SHARED link, so
 *    anyone may append anything to it, and the page must never do something it
 *    was not designed to be asked for.
 *  - it is an INSTRUCTION, not state. It is consumed once, on mount, and
 *    stripped from the address with replaceState, so a refresh does not
 *    re-prompt and a copied link is the document rather than the prompt.
 *  - stripping it keeps EVERY other parameter byte for byte — F2's `$` values
 *    are in this same query string and are the reader's document, not ours.
 *    So the pairs are re-emitted exactly as they arrived rather than round
 *    tripped through URLSearchParams, which re-encodes what it did not have to
 *    (`lib/story/url-values` learned this first and for the same reason).
 */

export const INTENTS = ['fork', 'comment'] as const;
export type Intent = (typeof INTENTS)[number];

/** The parameter's name, in one place: the reader, the stripper and the writer. */
export const INTENT_KEY = 'intent';

/** `+` is a space in a query string; bytes that will not decode are `null`. */
function decode(part: string): string | null {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

interface Pair {
  /** Exactly the bytes between the `&`s — what a preserved param is re-emitted as. */
  raw: string;
  /** The decoded key, when it decodes. */
  key: string | null;
  /** The decoded value, when it decodes. */
  value: string | null;
}

function pairs(search: string): Pair[] {
  const body = search.startsWith('?') ? search.slice(1) : search;
  return body.split('&').filter(Boolean).map((raw) => {
    const eq = raw.indexOf('=');
    const [k, v] = eq === -1 ? [raw, ''] : [raw.slice(0, eq), raw.slice(eq + 1)];
    return { raw, key: decode(k), value: decode(v) };
  });
}

const join = (kept: string[]): string => (kept.length ? `?${kept.join('&')}` : '');

/**
 * What this address asks the page to do, or nothing. The FIRST `intent` wins,
 * as URLSearchParams reads it, and anything outside the allowlist is nothing.
 */
export function readIntent(search: string): Intent | null {
  const found = pairs(search).find((p) => p.key === INTENT_KEY);
  const value = found?.value ?? null;
  return (INTENTS as readonly string[]).includes(value ?? '') ? (value as Intent) : null;
}

/** The same query string with every `intent` removed and nothing else touched. */
export function stripIntent(search: string): string {
  return join(pairs(search).filter((p) => p.key !== INTENT_KEY).map((p) => p.raw));
}

/**
 * The same query string carrying THIS intent — the return address for a door
 * that leads out of the document (login) and has to lead back into it doing
 * what was asked. Any existing `intent` is replaced, never appended twice.
 */
export function withIntent(search: string, intent: Intent): string {
  return join([...pairs(search).filter((p) => p.key !== INTENT_KEY).map((p) => p.raw), `${INTENT_KEY}=${intent}`]);
}
