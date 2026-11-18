/**
 * SOURCE IDENTITIES for a page shown before it is published (a draft, lib/page-drafts): every element written in the
 * source gets a `data-af-id` (an id already written stays; a new one is `af-N`, as publish mints them), and where its
 * start tag sits in that same source (1-based line and column), so a reader's selection can name the line the author
 * wrote. Elements the parser implies, and template contents, get none. Author bytes outside the inserted attributes
 * are untouched.
 */
import { applyEdits, attribute, insertAttribute, parseSource, written, type Edit } from './html-source.ts';

const NODE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

interface SourceIdentities {
  html: string;
  /** Each id -> its start tag's [line, column] in the source given, both 1-based. */
  positions: Record<string, [number, number]>;
}

export function identifySourceElements(source: string): SourceIdentities {
  const document = parseSource(source);
  const taken = new Set([...document.elements, ...document.templateElements].map((element) => attribute(element, 'data-af-id')).filter((id): id is string => id !== null));
  const positions = Object.create(null) as Record<string, [number, number]>;
  const edits: Edit[] = [];
  let next = 1;
  for (const element of document.elements) {
    if (!written(element)) continue;
    const tag = element.sourceCodeLocation!.startTag!;
    let id = attribute(element, 'data-af-id');
    if (id !== null) {
      // A written id the page repeats, or one that is no identity, stays as written and is not addressed.
      if (!NODE_ID.test(id) || Object.hasOwn(positions, id)) continue;
    } else {
      do id = `af-${next++}`; while (taken.has(id));
      taken.add(id);
      edits.push(insertAttribute(source, element, 'data-af-id', id));
    }
    positions[id] = [tag.startLine, tag.startCol];
  }
  return { html: edits.length ? applyEdits(source, edits) : source, positions };
}
