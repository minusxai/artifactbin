import {expect,it} from 'vitest';
import {parseJsx} from '../../jsx/parse';
import {serializeJsx} from '../../jsx/serialize';
import {createDocumentGraph,graphNodes,graphSource,graphNodeAt,graphIntegrity} from '../document-graph';
const fixtures=[
 '<section id="root"><p id="a">A &amp; β 👩</p><p id="b">B</p></section>',
 '<><p id="a">First</p><img id="b" src="ref:image" /></>',
 '<Helmet><style>{`p { color: red; }`}</style></Helmet><p id="a" title="&quot;Hi&quot;">Body</p>',
 '{$show ? (<p id="a">Yes</p>) : (<p id="b">No</p>)}',
 '{$show && (<p id="a">Yes</p>)}',
 '<Value name="payload" type="table" default={[{"z":1,"a":2}]} />',
];
it.each(fixtures)('round-trips ordered JSX through independently addressed nodes: %s',source=>{
 const parsed=parseJsx(source);if(!parsed.ok)throw new Error(parsed.error);
 const canonical=serializeJsx(parsed.nodes),graph=createDocumentGraph(canonical,7);
 expect(graphSource(graph)).toBe(canonical);
 expect(serializeJsx(graphNodes(graph))).toBe(canonical);
 expect(graphIntegrity(graph)).toEqual([]);
 expect(graph.bytes).toBe(Buffer.byteLength(canonical));
 expect(Object.values(graph.nodes).every(n=>n.selfVersion===7&&n.childrenVersion===7&&n.subtreeVersion===7)).toBe(true);
});
it('retains stable internal keys across attribute edits and sibling moves',()=>{
 const before=createDocumentGraph(fixtures[0]!,1),nodes=graphNodes(before),root=nodes[0]!;
 if(root.type!=='element')throw new Error('expected element');
 const first=root.children[0]!,second=root.children[1]!;
 if(first.type!=='element')throw new Error('expected element');
 first.attributes.push({name:'title',value:{static:true,json:'changed'},start:0,end:0});
 root.children=[second,first];
 const next=createDocumentGraph(nodes,2);
 expect(graphNodeAt(next,[0,1])).toBe(graphNodeAt(before,[0,0]));
 expect(graphNodeAt(next,[0,0])).toBe(graphNodeAt(before,[0,1]));
 expect(graphIntegrity(next)).toEqual([]);
});
it('detects dangling links, multiple parents, orphaned nodes and cycles',()=>{
 const graph=createDocumentGraph(fixtures[0]!,1),first=graphNodeAt(graph,[0,0]),second=graphNodeAt(graph,[0,1]);
 const dangling=structuredClone(graph);dangling.nodes[first]!.children.push('missing');expect(graphIntegrity(dangling)).not.toEqual([]);
 const duplicated=structuredClone(graph);duplicated.nodes[second]!.children.push(first);expect(graphIntegrity(duplicated)).not.toEqual([]);
 const cyclic=structuredClone(graph);cyclic.nodes[first]!.children.push(graphNodeAt(graph,[0]));expect(graphIntegrity(cyclic)).not.toEqual([]);
 const orphan=structuredClone(graph);orphan.nodes.detached=structuredClone(graph.nodes[first]!);expect(graphIntegrity(orphan)).not.toEqual([]);
});
it('records reference metadata on its owning node, excluding isolated iframe contents',()=>{
 const graph=createDocumentGraph('<main><img src="ref:abc123" /><Iframe><img src="ref:xyz123" /></Iframe></main>',1);
 expect(graph.nodes[graphNodeAt(graph,[0])]!.refs).toEqual([]);
 expect(graph.nodes[graphNodeAt(graph,[0,0])]!.refs).toEqual([{id:'abc123',kind:'image'}]);
 expect(graph.nodes[graphNodeAt(graph,[0,1,0])]!.refs).toEqual([]);
 expect(graph.nodes[graphNodeAt(graph,[0,1,0])]!.selectors).toEqual([]);
});
it('stores UTF-16 subtree sizes and certifies only inert prose positions',()=>{
 const graph=createDocumentGraph('<Helmet><title>Title</title></Helmet><section><p>👩 β</p><p>className="x"</p></section>',1);
 expect(graph.nodes.$root!.subtreeUnits).toBe(graphSource(graph).length);
 expect(graph.nodes[graphNodeAt(graph,[1,0,0])]!.prose).toBe(true);
 expect(graph.nodes[graphNodeAt(graph,[1,1,0])]!.prose).toBe(false);
 expect(graph.nodes[graphNodeAt(graph,[0,0,0])]!.prose).toBe(false);
});
