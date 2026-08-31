/**
 * The WYSIWYG write-back carries a Helmet through untouched: the canvas hides
 * the Helmet (unregistered
 * component → renders nothing), but every editor save re-serializes the WHOLE
 * tree — so a text edit anywhere in the body must leave the Helmet, its
 * script, and its style byte-stable in the emitted source.
 */
import { describe, expect, it } from 'vitest';
import { applyDomEditsToJsx } from '@/lib/data/story/jsx-edit';
import { canonicalizeMarkup } from '@/lib/story/jsx-tier';

const HELMET =
  '<Helmet><title>Doc</title><style>{`h1 { color: red; }`}</style><script>{`document.body.dataset.ran = "1";`}</script></Helmet>';

describe('editor write-back preserves Helmet', () => {
  it('a body text edit leaves the Helmet byte-stable', () => {
    const source = canonicalizeMarkup(HELMET + '<div className="p-4"><p>original text</p></div>');
    // The <p> host: Helmet is node 0, div node 1, p its first child.
    const result = applyDomEditsToJsx(source, [{ astPath: '1.0', innerHtml: 'edited text' }]);
    expect(result.errors).toEqual([]);
    expect(result.source).toContain('edited text');
    expect(result.source).toContain('<Helmet>');
    expect(result.source).toContain('document.body.dataset.ran');
    expect(result.source).toContain('h1 { color: red; }');
    // Canonical in, canonical out: only the edited span differs.
    expect(canonicalizeMarkup(result.source)).toBe(result.source);
  });
});

/**
 * Canonicalization is a NORMALIZER: it may move a Helmet, never delete one.
 *
 * `hoistHelmet` keeps the first Helmet and drops the rest, which is correct
 * only for a document the grammar already admits — one Helmet. Run on
 * unvalidated source it turns an author error ("a document may carry only one
 * <Helmet>") into silent destruction of whatever the surviving Helmet did not
 * carry: the stylesheet, the meta pairs, the script.
 *
 * That is exactly what the editor's code mode did. Typing a second <Helmet> at
 * the top of a document saved as "v3 · saved" and the ORIGINAL Helmet — title,
 * meta, style and a 2.5 KB script — was gone from the row, with no error
 * anywhere. The publish door never saw two Helmets, because this ran first.
 */
describe('canonicalizeMarkup on a document the grammar rejects', () => {
  const TWO = '<Helmet><title>second</title></Helmet>' + HELMET + '<p>body</p>';

  it('leaves it exactly as authored, for the validator to report', () => {
    expect(canonicalizeMarkup(TWO)).toBe(TWO);
  });

  it('never drops what the surviving Helmet did not carry', () => {
    const out = canonicalizeMarkup(TWO);
    expect(out).toContain('<style>');
    expect(out).toContain('<script>');
    expect(out.match(/<Helmet>/g)).toHaveLength(2);
  });

  it('still hoists a VALID document (the normalizer keeps working)', () => {
    const authored = '<h1>title</h1>' + HELMET + '<p>body</p>';
    expect(canonicalizeMarkup(authored).startsWith('<Helmet>')).toBe(true);
  });
});
