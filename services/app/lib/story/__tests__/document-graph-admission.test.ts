import {expect,it} from 'vitest';
import type {DocumentOperation} from '@artifactbin/contracts';
import {createDocumentGraph,graphSource} from '../document-graph';
import {prepareGraphOperation,prepareGraphSource,graphAdmissionPlan} from '../document-graph-admission';
import {applyGraphPatch} from '../document-graph-patch';
import {publishJsx} from '../jsx-tier';
import {stampNodeIds} from '../node-ids';
const context={loadRef:async()=>null};
async function setup(source='<section id="root"><p id="a">Alpha</p><p id="b">Beta</p></section>'){
 const published=await publishJsx({},source,context);if(published instanceof Response)throw new Error(await published.text());
 return {id:'test',version:1,document:createDocumentGraph(stampNodeIds(published.source!).source,1),meta:published.meta};
}
it('admits independent attribute and text edits once and merges both valid results',async()=>{
 const base=await setup();
 const tokens=await Promise.all([
  prepareGraphOperation(base,[{kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'}],context),
  prepareGraphOperation(base,[{kind:'setText',path:[0,1,0],value:'Changed β'}],context),
 ]);
 const plans=tokens.map(token=>{if(token instanceof Response)throw new Error('Rejected');return graphAdmissionPlan(token);});
 const first=applyGraphPatch(base.document,1,plans[0]!.patch)!,both=applyGraphPatch(first,2,plans[1]!.patch)!;
 expect(both).not.toBeNull();expect(graphSource(both)).toContain('font-bold');expect(graphSource(both)).toContain('Changed β');
 expect(await publishJsx({},graphSource(both),context)).not.toBeInstanceOf(Response);
});
it.each([
 [{kind:'setAttribute',path:[0,0],name:'onClick',value:'bad'}],
 [{kind:'insert',parent:[0],index:1,source:'<script>bad()</script>'}],
 [{kind:'insert',parent:[0],index:1,source:'{$missing}'}],
 [{kind:'setText',path:[0,0,0],value:'bad\0text'}],
] as DocumentOperation[][])('does not certify invalid operation batches',async(...operations)=>{
 const token=await prepareGraphOperation(await setup(),operations,context);
 expect(token).toBeInstanceOf(Response);expect((token as Response).status).toBe(400);
});
it('requires an authentic server admission token',()=>{expect(()=>graphAdmissionPlan({} as never)).toThrow('Unvalidated');});

it('preserves duplicate-ID repair for pasted source before matching graph identities',async()=>{
 const base=await setup(),source=graphSource(base.document).replace('id="b"','id="a"');
 const token=await prepareGraphSource(base,source,context);
 expect(token).not.toBeInstanceOf(Response);if(token instanceof Response)throw new Error(await token.text());
 const plan=graphAdmissionPlan(token);expect(new Set(plan.ids).size).toBe(plan.ids.length);
 const result=applyGraphPatch(base.document,1,plan.patch)!;
 expect(graphSource(result)).toContain('Alpha');expect(graphSource(result)).toContain('Beta');
});
it.each([
 {source:'<Grid id="grid"><GridItem id="left"><p id="a">Alpha</p></GridItem><GridItem id="right"><p id="b">Beta</p></GridItem></Grid>',root:0},
 {source:'<Helmet><Value name="rows" type="table" value={[{"id":1,"a":1,"b":2}]} /></Helmet><For id="loop" each={$rows} keyBy="id"><section id="left"><p id="a">Alpha</p></section><section id="right"><p id="b">Beta</p></section></For>',root:1},
 {source:'<Helmet><Value name="rows" type="table" value={[{"id":1,"a":1,"b":2}]} /></Helmet><DataTable id="table" data="$rows"><Column col="a"><p id="a">Alpha</p></Column><Column col="b"><p id="b">Beta</p></Column></DataTable>',root:1},
])('independent descendant styles preserve component validity without replanning: $source',async({source,root})=>{
 const base=await setup(source),plans=[];
 for(const index of [0,1]){
  const token=await prepareGraphOperation(base,[{kind:'setAttribute',path:[root,index,0],name:'className',value:index?'italic':'font-bold'}],context);
  if(token instanceof Response)throw new Error(await token.text());plans.push(graphAdmissionPlan(token));
 }
 const both=applyGraphPatch(applyGraphPatch(base.document,1,plans[0]!.patch)!,2,plans[1]!.patch)!;
 expect(both).not.toBeNull();expect(await publishJsx({},graphSource(both),context)).not.toBeInstanceOf(Response);
});
