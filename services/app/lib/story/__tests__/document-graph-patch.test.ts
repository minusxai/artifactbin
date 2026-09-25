import {expect,it} from 'vitest';
import type {DocumentOperation} from '@artifactbin/contracts';
import {applyOperationsToNodes} from '../document-operation';
import {createDocumentGraph,graphNodes,graphSource,graphIntegrity,type DocumentGraph} from '../document-graph';
import {prepareGraphPatch,applyGraphPatch} from '../document-graph-patch';
const source='<main id="root"><section id="left"><p id="a">Alpha</p></section><section id="right"><p id="b">Beta</p></section></main>';
const setup=()=>createDocumentGraph(source,1);
const plan=(base:DocumentGraph,operations:DocumentOperation[])=>prepareGraphPatch(base,createDocumentGraph(applyOperationsToNodes(graphNodes(base),operations),2),1);
it('prepared attribute edits to independent siblings commit without replanning',()=>{
 const base=setup();
 const a=plan(base,[{kind:'setAttribute',path:[0,0,0],name:'title',value:'A'}]);
 const b=plan(base,[{kind:'setAttribute',path:[0,1,0],name:'title',value:'B'}]);
 const first=applyGraphPatch(base,1,a)!,both=applyGraphPatch(first,2,b)!;
 expect(both).not.toBeNull();expect(graphSource(both)).toContain('title="A"');expect(graphSource(both)).toContain('title="B"');expect(graphIntegrity(both)).toEqual([]);
});
it.each<DocumentOperation[][]>([
 [[{kind:'insert',parent:[0,0],index:1,source:'<p id="new">New</p>'}],[{kind:'setText',path:[0,1,0,0],value:'Changed'}]],
 [[{kind:'delete',path:[0,0,0]}],[{kind:'setAttribute',path:[0,1,0],name:'className',value:'font-bold'}]],
 [[{kind:'move',path:[0,0,0],parent:[0,1],index:1}],[{kind:'setAttribute',path:[0,1,0],name:'title',value:'Still independent'}]],
])('merges independent structural composites without replacing the current graph', (left,right)=>{
 const base=setup(),a=plan(base,left),b=plan(base,right),first=applyGraphPatch(base,1,a)!;
 const both=applyGraphPatch(first,2,b);expect(both).not.toBeNull();expect(graphIntegrity(both!)).toEqual([]);
});
it('rejects same-node, ancestor/descendant and child-list conflicts atomically',()=>{
 const base=setup(),change=plan(base,[{kind:'setText',path:[0,0,0,0],value:'Changed'}]);
 const after=applyGraphPatch(base,1,change)!;
 for(const ops of [[{kind:'setText',path:[0,0,0,0],value:'Other'}],[{kind:'delete',path:[0,0]}],[{kind:'setAttribute',path:[0,0],name:'title',value:'Ancestor'}]] as DocumentOperation[][])expect(applyGraphPatch(after,2,plan(base,ops))).toBeNull();
 const insert=plan(base,[{kind:'insert',parent:[0,0],index:1,source:'<p>One</p>'}]);
 expect(applyGraphPatch(applyGraphPatch(base,1,insert)!,2,plan(base,[{kind:'insert',parent:[0,0],index:1,source:'<p>Two</p>'}]))).toBeNull();
});
it('guards new identities, ABA revisions, size and explicit whole replacement',()=>{
 const base=setup(),a=plan(base,[{kind:'setText',path:[0,0,0,0],value:'Changed'}]);
 const first=applyGraphPatch(base,1,a)!;
 const back=prepareGraphPatch(first,createDocumentGraph(graphNodes(base),3),2);
 const restored=applyGraphPatch(first,2,back)!;
 expect(graphSource(restored)).toBe(source);expect(applyGraphPatch(restored,3,a)).toBeNull();
 const whole=prepareGraphPatch(base,createDocumentGraph('<p>Replacement</p>',2),1,{whole:true});
 expect(applyGraphPatch(first,2,whole)).toBeNull();
 const insert=plan(base,[{kind:'insert',parent:[],index:1,source:'<p>New</p>'}]);
 const collision=structuredClone(base);Object.assign(collision.nodes,insert.inserted);expect(applyGraphPatch(collision,1,insert)).toBeNull();
 expect(applyGraphPatch({...base,bytes:2_000_000},1,insert)).toBeNull();
});
it('guards selector membership so a concurrent new consumer cannot escape validation',()=>{
 const base=createDocumentGraph('<main><section id="a"><p>Alpha</p></section><section id="b"><p>Beta</p></section></main>',1);
 const candidate=createDocumentGraph(applyOperationsToNodes(graphNodes(base),[{kind:'setAttribute',path:[0,0,0],name:'title',value:'Checked absence'}]),2);
 const guarded=prepareGraphPatch(base,candidate,1,{selectors:['use:rows']});
 const insert=plan(base,[{kind:'insert',parent:[0,1],index:1,source:'<DataTable data="$rows" />'}]);
 expect(applyGraphPatch(applyGraphPatch(base,1,insert)!,2,guarded)).toBeNull();
 const independent=plan(base,[{kind:'setAttribute',path:[0,1,0],name:'title',value:'No binding change'}]);
 expect(applyGraphPatch(applyGraphPatch(base,1,independent)!,2,guarded)).not.toBeNull();
});
it('merges subtree length deltas instead of overwriting a concurrent ancestor total',()=>{
 const base=setup(),a=plan(base,[{kind:'setText',path:[0,0,0,0],value:'Long 👩🏽‍💻 text'}]),b=plan(base,[{kind:'setText',path:[0,1,0,0],value:'B'}]);
 const both=applyGraphPatch(applyGraphPatch(base,1,a)!,2,b)!;
 expect(both.nodes.$root!.subtreeUnits).toBe(graphSource(both).length);expect(graphIntegrity(both)).toEqual([]);
});
it('rejects reuse of an identity created and deleted since planning, even in another branch',()=>{
 const base=setup();
 const stale=plan(base,[{kind:'insert',parent:[0,0],index:1,source:'<p id="once">Stale</p>'}]);
 const created=applyGraphPatch(base,1,plan(base,[{kind:'insert',parent:[0,1],index:1,source:'<p id="once">First</p>'}]))!;
 const deleted=applyGraphPatch(created,2,prepareGraphPatch(created,createDocumentGraph(applyOperationsToNodes(graphNodes(created),[{kind:'delete',path:[0,1,1]}]),3),2))!;
 expect(applyGraphPatch(deleted,3,stale)).toBeNull();
});
it('allows an intentional restore against observed identity history',()=>{
 const base=setup();
 const deleted=applyGraphPatch(base,1,plan(base,[{kind:'delete',path:[0,0,0]}]))!;
 const restore=prepareGraphPatch(deleted,createDocumentGraph(applyOperationsToNodes(graphNodes(deleted),[{kind:'insert',parent:[0,0],index:0,source:'<p id="a">Restored</p>'}]),3),2);
 expect(applyGraphPatch(deleted,2,restore)).not.toBeNull();
});
