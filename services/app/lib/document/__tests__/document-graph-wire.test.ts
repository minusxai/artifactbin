import {describe,expect,it} from 'vitest';
import {applyGraphPatch,prepareGraphPatch} from '../document-graph-patch';
import {applyOperationsToNodes} from '../document-operation';
import {createDocumentGraph,graphIntegrity,graphNodes,graphSource,GRAPH_ROOT} from '../document-graph';
import {packDocumentGraph,unpackDocumentGraph} from '../document-graph-wire';

const SOURCE='<main id="root"><section id="left"><h2 id="h">Heading</h2><p id="a">Alpha <strong id="s">bold</strong></p></section><section id="right"><p id="b">Beta</p><ul id="u"><li id="l1"><p id="lp">one</p></li></ul></section></main>';
/** What the page prefetch used to ship, and what the editor must hold after inflating: the same graph, key for key. */
const roundTrip=(graph:ReturnType<typeof createDocumentGraph>)=>{
 const source=graphSource(graph),packed=packDocumentGraph(graph,source);
 expect(packed).not.toBeNull();
 // On the wire it is JSON: nothing in it may rely on object identity or undefined.
 return {packed:packed!,graph:unpackDocumentGraph(JSON.parse(JSON.stringify(packed)),source)};
};

describe('the editor graph wire form',()=>{
 it('inflates a fresh graph to exactly the stored one',()=>{
  const stored=createDocumentGraph(SOURCE,4),{graph}=roundTrip(stored);
  expect(graph).toEqual(stored);
  expect(graphIntegrity(graph)).toEqual([]);
 });
 it('carries the node keys once and none of what the source already says',()=>{
  const stored=createDocumentGraph(SOURCE,4),{packed}=roundTrip(stored);
  expect(packed.keys).toHaveLength(Object.keys(stored.nodes).length-1);
  expect(packed.keys).not.toContain(GRAPH_ROOT);
  const wire=JSON.stringify(packed);
  for(const derived of ['"ast"','"parts"','"selectors"','"subtreeUnits"','"partUnits"','"parent"'])expect(wire).not.toContain(derived);
 });
 it('inflates a source-preserving (forked or archived) graph, whose parts are not the canonical ones',()=>{
  const odd='<main id="root">\n  <p id=\'a\' title=\'x\'>Alpha</p>\n\n  <p id="b" className = "k">Beta &amp; more</p>\n</main>\n';
  const stored=createDocumentGraph(odd,2,{preserveSource:true}),{graph,packed}=roundTrip(stored);
  expect(graph).toEqual(stored);
  expect(packed.parts).toBeDefined();
  expect(graphSource(graph)).toBe(odd);
 });
 it('inflates a graph whose nodes were last touched in different versions',()=>{
  const base=createDocumentGraph(SOURCE,1);
  const next=createDocumentGraph(applyOperationsToNodes(graphNodes(base),[{kind:'setText',path:[0,0,1,0],value:'Changed'}]),2);
  const first=applyGraphPatch(base,1,prepareGraphPatch(base,next,1))!;
  const second=applyGraphPatch(first,2,prepareGraphPatch(first,createDocumentGraph(applyOperationsToNodes(graphNodes(first),[{kind:'insert',parent:[0,1],index:1,source:'<p id="n">New</p>'}]),3),2))!;
  const versions=new Set(Object.values(second.nodes).map(node=>node.selfVersion));
  expect(versions.size).toBeGreaterThan(1);
  expect(roundTrip(second).graph).toEqual(second);
 });
 it('refuses (returns null) when the stored graph is not what the source rebuilds, so the door sends the whole graph',()=>{
  const stored=createDocumentGraph(SOURCE,1);
  const forged=structuredClone(stored);
  const key=Object.keys(forged.nodes).find(k=>forged.nodes[k]!.selectors.includes('id:a'))!;
  forged.nodes[key]!.selectors=['id:zzz'];
  expect(packDocumentGraph(forged,graphSource(forged))).toBeNull();
  expect(packDocumentGraph(stored,SOURCE+'<p id="extra">x</p>')).toBeNull();
 });
 it('throws on a source that does not match its keys, for the loader to refetch whole',()=>{
  const stored=createDocumentGraph(SOURCE,1),packed=packDocumentGraph(stored,SOURCE)!;
  expect(()=>unpackDocumentGraph(packed,SOURCE+'<p id="extra">x</p>')).toThrow();
 });
});
