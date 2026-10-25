import { expect, it } from 'vitest';
import { parseHtmlNodeAnchor, htmlTextFingerprint, type HtmlNodeAnchor } from '@artifactbin/contracts';
import { htmlCommentNodes, resolveHtmlCommentAnchor, validHtmlCommentRange } from '../html-anchor';
const anchor = (over: Partial<HtmlNodeAnchor> = {}): HtmlNodeAnchor => ({ kind: 'html-node', v: 1, revision: '2', nodeId: 'n1', quote: 'same words', ...over });
it('uses persistent HTML IDs and decoded text without compiler paths', () => {
  const nodes = htmlCommentNodes('<!doctype html><p data-af-id="n1">same <strong>words</strong> &amp; more</p>');
  expect(resolveHtmlCommentAnchor(nodes, anchor())).toEqual({ node: { nodeId: 'n1', text: 'same words & more' }, quoteFound: true });
});
it('does not retarget a removed node to an equal quote at another identity', () => {
  expect(resolveHtmlCommentAnchor(htmlCommentNodes('<p data-af-id="n2">same words</p>'), anchor())).toEqual({ node: null, quoteFound: false });
});
it('refuses duplicate IDs rather than choosing one occurrence', () => {
  expect(resolveHtmlCommentAnchor(htmlCommentNodes('<p data-af-id="n1">same words</p><p data-af-id="n1">same words</p>'), anchor()).node).toBeNull();
});
it('requires a captured range to describe the exact text and fingerprint', () => {
  const node = { nodeId: 'n1', text: '😀 same words' };
  const picked = anchor({ range: { start: 3, end: 13, length: 13, fingerprint: htmlTextFingerprint(node.text) } });
  expect(validHtmlCommentRange(node, picked)).toBe(true);
  expect(validHtmlCommentRange({ ...node, text: 'ab same words' }, picked)).toBe(false);
  expect(validHtmlCommentRange(node, { ...picked, range: { ...picked.range!, start: 0 } })).toBe(false);
});
it('validates a dynamic scope without interpreting runtime words as source or accepting a static ID elsewhere',()=>{
 const dynamic=anchor({nodeId:'task:123',ancestorId:'tasks',quote:'Runtime words'});
 expect(resolveHtmlCommentAnchor(htmlCommentNodes('<ul data-af-id="tasks"></ul>'),dynamic)).toEqual({node:{nodeId:'tasks',text:''},quoteFound:false});
 expect(resolveHtmlCommentAnchor(htmlCommentNodes('<ul data-af-id="other"></ul>'),dynamic).node).toBeNull();
 expect(resolveHtmlCommentAnchor(htmlCommentNodes('<ul data-af-id="tasks"></ul><p data-af-id="task:123">Runtime words</p>'),dynamic).node).toBeNull();
});
it('decodes bounded explicit selection segments and rejects malformed parts',()=>{
 const segment={nodeId:'part',quote:'selected',range:{start:0,end:8,length:8,fingerprint:'abcd'}};
 const anchor={kind:'html-node',v:1,revision:'3',nodeId:'root',quote:'selected',segments:[segment]};
 expect(parseHtmlNodeAnchor(anchor)?.segments).toEqual([segment]);expect(parseHtmlNodeAnchor({...anchor,segments:[]} )?.segments).toEqual([]);
 for(const segments of [[{...segment,range:undefined}],[{...segment,nodeId:null}],[{...segment,extra:true}],Array(257).fill(segment)])expect(parseHtmlNodeAnchor({...anchor,segments})).toBeNull();
});
