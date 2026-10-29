// The data components' earlier names (lib/jsx/component-names) through the document's own writers: the in-place id
// stamp keeps what the author wrote, and a stored tree revived without a parse is canonicalised the same way the parser does.
import { describe, expect, it } from 'vitest';
import { parseJsx, serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { stampNodeIdsInPlace } from '../node-ids';
import { decodeDocumentNodes, encodeDocumentNodes } from '../document-node-codec';

const nodesOf = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};

describe('component aliases in the stored document', () => {
  it('stamps a node id in place after an old name\'s attributes, and on a bare old tag', () => {
    const mint = (() => { let i = 0; return () => `N${i++}aa`; })();
    const stamped = stampNodeIdsInPlace('<Number data="$q" />\n<Question />', { mint });
    expect(stamped.source).toBe('<Number data="$q" id="N0aa" />\n<Question id="N1aa" />');
  });

  it('canonicalises a stored tree revived without a parse, keeping its spelling', () => {
    const legacy = { schema: 1 as const, kind: 'jsx' as const, roots: [{ type: 'element', tag: 'Question', isComponent: true, attributes: [], children: [{ type: 'element', tag: 'Number', isComponent: true, attributes: [], children: [], selfClosing: true }], selfClosing: false }] };
    const [root] = decodeDocumentNodes(legacy) as JsxElement[];
    expect(root!.tag).toBe('Chart');
    expect(root!.authoredTag).toBe('Question');
    expect((root!.children[0] as JsxElement).tag).toBe('Cell');
    expect(serializeJsx([root!])).toBe('<Question><Number /></Question>');
    // A tree encoded from a parse round-trips unchanged.
    const parsed = nodesOf('<Question data="$q" />');
    expect(decodeDocumentNodes(encodeDocumentNodes(parsed))[0]).toMatchObject({ tag: 'Chart', authoredTag: 'Question' });
  });

});
