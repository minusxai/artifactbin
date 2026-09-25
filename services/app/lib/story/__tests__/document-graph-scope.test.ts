import {expect,it} from 'vitest';
import type {DocumentOperation} from '@artifactbin/contracts';
import {createDocumentGraph,graphNodes,graphNodeAt} from '../document-graph';
import {applyOperationsToNodes} from '../document-operation';
import {graphValidationScope} from '../document-graph-scope';
import {graphSource} from '../document-graph';
import {validateMarkupStructure} from '../local-validation';
const scope=(source:string,operations:DocumentOperation[])=>{
 const before=createDocumentGraph(source,1),after=createDocumentGraph(applyOperationsToNodes(graphNodes(before),operations),2);
 return {before,after,result:graphValidationScope(before,after)};
};
it('validates changed HTML and ancestor context without consuming sibling subtrees',()=>{
 const {before,result}=scope('<main><section><p>Alpha</p></section><section><p>Beta</p></section></main>',[{kind:'setAttribute',path:[0,0,0],name:'className',value:'font-bold'}]);
 expect(result.source).toContain('Alpha');expect(result.source).not.toContain('Beta');
 expect(result.reads).toContainEqual({key:graphNodeAt(before,[0,0,0]),facet:'subtreeVersion'});
 expect(result.reads).not.toContainEqual({key:graphNodeAt(before,[0]),facet:'subtreeVersion'});
});
it('includes sibling Columns when changing a DataTable child',()=>{
 const {before,result}=scope('<Helmet><Value name="rows" type="table" default={[]} /></Helmet><DataTable data="$rows"><Column col="a" /><Column col="b" /></DataTable><p>Unrelated</p>',[{kind:'setAttribute',path:[1,0],name:'col',value:'b'}]);
 expect(result.source).toContain('<Column col="b" /><Column col="b" />');expect(result.source).not.toContain('Unrelated');
 expect(result.reads).toContainEqual({key:graphNodeAt(before,[1]),facet:'subtreeVersion'});
});
it('includes reverse consumers and guards absent consumers when a declaration changes',()=>{
 const {result}=scope('<Helmet><Value name="count" type="number" default={1} /></Helmet><p>{$count}</p><p>Unrelated</p>',[{kind:'setAttribute',path:[0,0],name:'type',value:'string'}]);
 expect(result.source).toContain('{$count}');expect(result.source).not.toContain('Unrelated');expect(result.selectors).toContain('use:count');
});
it('records absent declaration names consulted by a new binding',()=>{
 const {result}=scope('<main><p>Alpha</p><p>Beta</p></main>',[{kind:'insert',parent:[0,0],index:1,source:'{$missing}'}]);
 expect(result.selectors).toContain('declaration:missing');expect(result.source).not.toContain('Beta');
});
it('checks authored-ID uniqueness and Helmet membership across separate branches',()=>{
 const {result}=scope('<main><section><p id="a">Alpha</p></section><section><p>Beta</p></section></main>',[{kind:'insert',parent:[0,1],index:1,source:'<p id="a">Duplicate</p>'}]);
 expect(result.errors).toContain('Duplicate authored node identity: a');expect(result.selectors).toContain('id:a');
});
it('includes reactive bindings on ancestor shells without their unrelated children',()=>{
 const {result}=scope('<Helmet><Value name="label" type="string" default="Title" /></Helmet><main title={$label}><p>Alpha</p><p>Beta</p></main>',[{kind:'setText',path:[1,0,0],value:'Changed'}]);
 expect(result.source).toContain('name="label"');expect(result.source).not.toContain('Beta');expect(result.selectors).toContain('declaration:label');
});

it.each([
 {source:'<main><p>Alpha</p><p>Beta</p></main>',operation:{kind:'setAttribute',path:[0,0],name:'onClick',value:'bad'}},
 {source:'<main><p>Alpha</p><p>Beta</p></main>',operation:{kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'}},
 {source:'<main><a href="https://example.com">Alpha</a><p>Beta</p></main>',operation:{kind:'setAttribute',path:[0,0],name:'href',value:'javascript:alert(1)'}},
 {source:'<main><p>Alpha</p><p>Beta</p></main>',operation:{kind:'insert',parent:[0],index:1,source:'<script>bad()</script>'}},
 {source:'<Helmet><Value name="count" type="number" default={1} /></Helmet><p>{$count}</p><p>Other</p>',operation:{kind:'delete',path:[0,0]}},
 {source:'<Helmet><Value name="rows" type="table" value={[{"a":1,"b":2}]} /></Helmet><DataTable data="$rows"><Column col="a" /><Column col="b" /></DataTable><p>Other</p>',operation:{kind:'setAttribute',path:[1,0],name:'col',value:'b'}},
] as Array<{source:string;operation:DocumentOperation}>)('agrees with the full structural validator for $operation.kind',({source,operation})=>{
 expect(validateMarkupStructure(source).errors).toEqual([]);
 const {after,result}=scope(source,[operation]);
 expect(validateMarkupStructure(result.source).errors.length===0&&result.errors.length===0).toBe(validateMarkupStructure(graphSource(after)).errors.length===0);
});
it('follows transitive reverse query dependencies to their visual consumers',()=>{
 const {result}=scope('<Helmet><Value name="rows" type="table" value={[{"a":1}]} /><Query name="q">{`SELECT a FROM rows`}</Query></Helmet><DataTable data="$q" /><p>Unrelated</p>',[{kind:'setAttribute',path:[0,0],name:'value',value:[{b:1}]}]);
 expect(result.source).toContain('<DataTable data="$q" />');expect(result.selectors).toContain('use:q');expect(result.source).not.toContain('Unrelated');
});
it.each([
 '<Grid><GridItem><p id="a">Alpha</p></GridItem><GridItem><p id="b">Beta</p></GridItem></Grid>',
 '<DataTable data="$rows"><Column col="a"><p id="a">Alpha</p></Column><Column col="b"><p id="b">Beta</p></Column></DataTable>',
 '<For each={$rows} keyBy="id"><section><p id="a">Alpha</p></section><section><p id="b">Beta</p></section></For>',
])('does not consume an entire component for an ordinary descendant style edit: %s',source=>{
 const {before,result}=scope(source,[{kind:'setAttribute',path:[0,0,0],name:'className',value:'font-bold'}]);
 expect(result.source).not.toContain('Beta');expect(result.reads).not.toContainEqual({key:graphNodeAt(before,[0]),facet:'subtreeVersion'});
});
