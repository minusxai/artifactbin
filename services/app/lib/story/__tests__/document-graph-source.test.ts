import {expect,it} from 'vitest';
import {createDocumentGraph,graphNodeAt,graphSource} from '../document-graph';
import {graphFromSource} from '../document-graph-source';
import {applyGraphPatch,prepareGraphPatch} from '../document-graph-patch';
it('retains authored identities across moves and text changes',()=>{
 const before=createDocumentGraph('<main id="m"><p id="a">Alpha</p><p id="b">Beta</p></main>',1);
 const next=graphFromSource(before,'<main id="m"><p id="b">Changed</p><p id="a">Alpha</p></main>',2);
 expect(graphNodeAt(next,[0,0])).toBe(graphNodeAt(before,[0,1]));
 expect(graphNodeAt(next,[0,0,0])).toBe(graphNodeAt(before,[0,1,0]));
 expect(graphNodeAt(next,[0,1])).toBe(graphNodeAt(before,[0,0]));
});
it('lowers independently prepared source edits to disjoint graph patches',()=>{
 const before=createDocumentGraph('<main id="m"><p id="a">Alpha</p><p id="b">Beta</p></main>',1);
 const a=prepareGraphPatch(before,graphFromSource(before,'<main id="m"><p id="a" title="A">Alpha</p><p id="b">Beta</p></main>',2),1);
 const b=prepareGraphPatch(before,graphFromSource(before,'<main id="m"><p id="a">Alpha</p><p id="b">Changed</p></main>',2),1);
 const result=applyGraphPatch(applyGraphPatch(before,1,a)!,2,b)!;
 expect(result).not.toBeNull();expect(graphSource(result)).toContain('title="A"');expect(graphSource(result)).toContain('Changed');
});
it('preserves unchanged anonymous siblings around an insertion without borrowing identities',()=>{
 const before=createDocumentGraph('<div><p>Alpha</p><p>Beta</p></div>',1);
 const next=graphFromSource(before,'<div><p>New</p><p>Alpha</p><p>Beta</p></div>',2);
 expect(graphNodeAt(next,[0,1])).toBe(graphNodeAt(before,[0,0]));
 expect(graphNodeAt(next,[0,2])).toBe(graphNodeAt(before,[0,1]));
 expect(Object.hasOwn(before.nodes,graphNodeAt(next,[0,0]))).toBe(false);
});
it('does not preserve an authored identity when its tag or id changes',()=>{
 const before=createDocumentGraph('<p id="a">Alpha</p>',1);
 for(const source of ['<div id="a">Alpha</div>','<p id="b">Alpha</p>'])expect(graphNodeAt(graphFromSource(before,source,2),[0])).not.toBe(graphNodeAt(before,[0]));
});
it('rejects ambiguous authored identities rather than assigning one key twice',()=>{
 const before=createDocumentGraph('<p id="a">Alpha</p>',1);
 expect(()=>graphFromSource(before,'<p id="a">Alpha</p><p id="a">Beta</p>',2)).toThrow('Duplicate authored node identity');
});
