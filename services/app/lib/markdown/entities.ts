/**
 * The slim HTML entity decoder: markdown-it's `entities` import is resolved here in every build and test runner that
 * bundles lib/markdown (scripts/lib/slim-entities.mjs), because the full HTML5 table is about 75 KB minified.
 * Numeric references and the common named ones decode; a rare name (`&alpha;`) stays as typed, the same in Node and
 * in the browser. markdown-it calls both decoders with one whole reference (`&name;`) and decodes numeric ones
 * itself; the full-text replace below also covers any longer string. `Tab`, `NewLine` and `colon` are here so a
 * scheme hidden behind them (`java&Tab;script:`) decodes before the link check sees it.
 */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', Tab: '\t', NewLine: '\n', colon: ':',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', middot: '·', times: '×', divide: '÷', deg: '°', plusmn: '±', laquo: '«', raquo: '»', bull: '•',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  harr: '↔', ne: '≠', le: '≤', ge: '≥', infin: '∞', check: '✓',
};
const REFERENCE = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;

function decodeOne(match: string, body: string): string {
  if (body[0] !== '#') return Object.hasOwn(NAMED, body) ? NAMED[body]! : match;
  const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
  const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return valid ? String.fromCodePoint(code) : '�';
}

/** Every reference in `text` this decoder knows, decoded; unknown names stay as typed. */
export function decodeHTML(text: string): string {
  return text.replace(REFERENCE, decodeOne);
}
/** markdown-it's strict form: a reference always ends in `;` here, so it is the same decoder. */
export const decodeHTMLStrict = decodeHTML;
