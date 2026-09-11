import {parseJsx,serializeJsx} from '@/lib/jsx';
import {hoistHelmet,validateHelmet} from './helmet';
import {fixHtmlNesting} from './nesting';

/**
 * Store markup in the serializer's canonical form — the invariant the edit
 * protocol rests on (concurrent-artifacts-edits.md). `serializeJsx` normalizes
 * expression values to JSON (`{{kind:"x"}}` → `{{"kind":"x"}}`), so a
 * non-canonical stored doc would make the WYSIWYG's first whole-tree
 * re-serialize differ far outside the edited node, and every derived splice
 * would swallow the document. Canonical form is a FIXPOINT, so after this the
 * editor's output differs only where the human actually edited.
 *
 * Source that cannot re-parse is returned untouched: publish validation has
 * already run and would have rejected it, and silently mangling text is worse
 * than a non-canonical row (the protocol degrades to whole-doc conflicts).
 */
export function canonicalizeMarkup(source: string): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  /*
   * Normalizing may MOVE a Helmet; it may never delete one. `hoistHelmet`
   * keeps the first and drops the rest, which is only correct for a document
   * the grammar already admits — and this runs on unvalidated source in the
   * edit path (applyEditScoped derives its splice against canonical form).
   * There, a second Helmet stopped being the author error it is and became
   * silent destruction of everything the surviving one did not carry: the
   * stylesheet, the meta pairs, the script. The editor's code mode reported
   * "saved" over it.
   *
   * So an invalid document goes through untouched, exactly as the unparseable
   * case does, and `validateHelmet` gets to say what is wrong with it.
   */
  if (validateHelmet(parsed.nodes).length > 0) return source;
  // Canonical placement is part of canonical FORM: the Helmet (if any) is
  // hoisted to first top-level node here, so agents see the move in the write
  // echo and every stored document reads document = [Helmet?, ...body].
  //
  // …and so is nesting the HTML parser will not undo. A `<p>` holding block
  // content serializes to markup that parses back as a DIFFERENT tree, which
  // is a hydration mismatch and a visible repaint on every read
  // (lib/story/nesting.ts). Canonical form is the right door precisely because
  // it is re-derived on every write: the editor's re-serialization, the edit
  // protocol's base, publish and preview all pass through here, so none of
  // them can reintroduce it.
  return serializeJsx(fixHtmlNesting(hoistHelmet(parsed.nodes)));
}
