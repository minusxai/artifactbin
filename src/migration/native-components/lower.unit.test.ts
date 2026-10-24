import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {NativeTypedAnalysis,RetainedJsxNode,NativeJson} from './analyze-contracts.ts';
import {lowerNativeComponents,type NativeLowerInput} from './lower.ts';
import {NATIVE_COMPONENT_TARGET} from './component-map.ts';
const digest='a'.repeat(64),proof='b'.repeat(64);
let next=0;
const text=(value:string):RetainedJsxNode=>({type:'text',graphKey:`text-${next++}`,start:0,end:0,value});
const element=(tag:string,attributes:Record<string,NativeJson>={},children:RetainedJsxNode[]=[]):RetainedJsxNode=>({type:'element',graphKey:`node-${next++}`,start:0,end:1,tag,isComponent:/^[A-Z]/.test(tag),attributes:Object.entries(attributes).map(([name,json])=>({name,value:{static:true,json},start:0,end:1})),children,selfClosing:!children.length});
function input(nodes:RetainedJsxNode[]):NativeLowerInput {
 const all:RetainedJsxNode[]=[];const visit=(node:RetainedJsxNode)=>{all.push(node);if(node.type==='element')node.children.forEach(visit);};nodes.forEach(visit);
 const analysis:NativeTypedAnalysis={key:{sourceNamespace:'synthetic',sourceId:'synthetic-page',version:1},documentSha256:digest,sourceSha256:digest,analysisSha256:digest,compilerSourceSha256:digest,nodes,flow:{imports:[],queries:[],mutations:[],values:[]},sourceSpans:all.map(node=>({sourceNode:node.graphKey,sourceStart:0,sourceEnd:1}))};
 return {analysis,targetRevision:NATIVE_COMPONENT_TARGET,identityBindings:all.filter(node=>node.type==='element'&&!node.control).map((node,index)=>({sourceNode:node.graphKey,retainedStart:node.start,retainedEnd:node.end,afId:`stable-${index}`,analysisSha256:digest,proofSha256:proof}))};
}
test('semantic layout preserves exact authored text, DOM IDs and ARIA separately from proved annotation IDs',()=>{
 const source=input([element('Card',{id:'dom-card','aria-labelledby':'heading'},[element('CardHeader',{},[element('CardTitle',{id:'heading'},[text('A < B & C\n  preserved')])]),element('Alert',{'aria-label':'Notice'},[text('Read this')])])]);
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/<section[^>]*id="dom-card"/);assert.match(result.html!,/aria-labelledby="heading"/);assert.match(result.html!,/data-af-id="stable-0"/);assert.match(result.html!,/A &lt; B &amp; C\n  preserved/);assert.doesNotMatch(result.html!,/<(?:Card|Grid|Alert)/);assert.match(result.css,/display:grid/);assert.equal(result.modules.length,0);
});
test('native compound controls retain child identity and emit only reviewed attributes and author property assignments',()=>{
 const source=input([element('Dialog',{defaultOpen:false},[element('DialogTrigger',{},[text('Open')]),element('DialogContent',{'aria-label':'Details'},[element('Textarea',{label:'Notes',value:'literal',rows:3}),element('DialogClose',{},[text('Close')])])]),element('Segmented',{label:'Mode',options:['One','Two'],value:'One'})]);
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/<af-dialog/);assert.match(result.html!,/<af-textarea[^>]*rows="3"/);assert.match(result.html!,/aria-label="Details"/);assert.deepEqual(result.modules.map(module=>module.name),['dialog','segmented','textarea']);assert.ok(result.assignments.some(value=>value.property==='options'));assert.doesNotMatch(result.html!,/@mx|Solid|eval\(|new Function/);
});
test('declarations, conditions, bindings and authored code remain explicit requirements, never successful static drops',()=>{
 const button=element('Button',{run:'save',args:{id:1}},[text('Save')]);
 const condition=element('div',{},[text('Conditional')]);if(condition.type!=='element')throw Error('fixture');condition.control={kind:'conditional',test:{kind:'signal',name:'ready'}};
 const source=input([button,condition,element('script',{},[text('window.privateEffect()')]),element('For',{each:'$rows',keyBy:'id'},[text('row')]),element('Question',{data:'$query'})]);
 source.analysis.flow.queries.push({name:'query',start:0,end:1,sql:'select 1'});source.analysis.flow.values.push({name:'ready',start:0,end:1,type:'boolean',default:false});source.analysis.flow.mutations.push({name:'save',start:0,end:1,expectedAffected:1});
 const result=lowerNativeComponents(source);assert.equal(result.html,null);for(const kind of ['query','mutation','value','condition','script','loop','chart','button-action'])assert.ok(result.requirements.some(value=>value.kind===kind),kind);assert.equal(result.requirements.find(value=>value.kind==='script')?.node?.type,'element');
});
test('identity proofs are mandatory, preserve historical reservations and cannot silently reuse removed IDs',()=>{
 const source=input([element('p',{id:'authored-id'},[text('Text')])]);source.identityBindings=[];assert.ok(lowerNativeComponents(source).blockers.some(value=>value.code==='identity-proof-required'));
 const proved=input([element('p',{},[text('Text')])]);proved.reservedIdentities=[{afId:'stable-0',sourceNode:'removed-owner'}];assert.ok(lowerNativeComponents(proved).blockers.some(value=>value.code==='identity-reuse'));
});
test('unknown components and unsupported native props return precise blockers',()=>{
 const result=lowerNativeComponents(input([element('UnregisteredWidget'),element('Button',{magic:'unknown'})]));assert.equal(result.status,'blocked');assert.equal(result.html,null);assert.ok(result.blockers.some(value=>value.tag==='UnregisteredWidget'&&value.code==='unsupported-component'));assert.ok(result.blockers.some(value=>value.tag==='Button'&&value.attribute==='magic'));
});
test('resource URLs require admitted rewriting while fragment IDREF links preserve authored targets',()=>{
 const source=input([element('a',{href:'#section'},[text('Jump')]),element('img',{src:'ref:synthetic',alt:'Example'})]);assert.ok(lowerNativeComponents(source).requirements.some(value=>value.kind==='resource'));
 source.urls=[{source:'ref:synthetic',target:'./assets/example.png',sha256:proof}];const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/href="#section"/);assert.match(result.html!,/src="\.\/assets\/example.png"/);
});
test('Number/Cell uses exact admitted formatter text rather than guessing old formats or flattening query references',()=>{
 const number=element('Number',{value:1234.5,fmt:',.2f',prefix:'$'});const source=input([number]);assert.ok(lowerNativeComponents(source).requirements.some(value=>value.kind==='format'));
 source.formattedValues=[{sourceNode:number.graphKey,analysisSha256:digest,formatterSha256:proof,text:'$1,234.50'}];const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/>\$1,234\.50<\/span>/);
});

test('native property shapes cannot be silently discarded by target setters',()=>{
 for(const node of [element('Segmented',{options:[{label:'Missing value'}]}),element('Textarea',{value:{unsafe:'object'}}),element('Slider',{value:'3'}),element('DataTable',{data:[]})]) {
  const result=lowerNativeComponents(input([node]));assert.equal(result.status,'blocked');assert.ok(result.blockers.some(value=>value.code==='unsupported-property-shape'));
 }
});
test('Grid geometry remains explicit until original positioned/flow CSS is admitted',()=>{
 const result=lowerNativeComponents(input([element('Grid',{cols:12},[element('GridItem',{x:0,y:0,w:6,h:4},[text('Panel')])])]));
 assert.equal(result.html,null);assert.ok(result.requirements.some(value=>value.kind==='style'&&value.tag==='Grid'));
 assert.equal(result.blockers.length,0);
});
test('head content and legacy table specifications retain explicit admission requirements',()=>{
 const source=input([element('Helmet',{},[element('title',{},[text('Exact title')]),element('style',{},[text('p { color: red }')])]),element('DataTable',{height:'40vh',columns:[{col:'count'}]})]);
 const result=lowerNativeComponents(source);assert.equal(result.html,null);assert.equal(result.blockers.length,0);
 for(const kind of ['head','style','table-column'])assert.ok(result.requirements.some(value=>value.kind===kind));
});
