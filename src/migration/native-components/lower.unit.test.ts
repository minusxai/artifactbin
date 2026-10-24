import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {NativeTypedAnalysis,RetainedJsxNode,NativeJson} from './analyze-contracts.ts';
import {lowerNativeComponents,formatNativeCell,type NativeLowerInput} from './lower.ts';
import {NATIVE_COMPONENT_TARGET} from './component-map.ts';
const digest='a'.repeat(64),proof='b'.repeat(64);
let next=0;
const text=(value:string):RetainedJsxNode=>({type:'text',graphKey:`text-${next++}`,start:0,end:0,value});
const element=(tag:string,attributes:Record<string,NativeJson>={},children:RetainedJsxNode[]=[]):RetainedJsxNode=>({type:'element',graphKey:`node-${next++}`,start:0,end:1,tag,isComponent:/^[A-Z]/.test(tag),attributes:Object.entries(attributes).map(([name,json])=>({name,value:{static:true,json},start:0,end:1})),children,selfClosing:!children.length});
function input(nodes:RetainedJsxNode[]):NativeLowerInput {
 const all:RetainedJsxNode[]=[];const visit=(node:RetainedJsxNode)=>{all.push(node);if(node.type==='element')node.children.forEach(visit);};nodes.forEach(visit);
 const analysis:NativeTypedAnalysis={key:{sourceNamespace:'synthetic',sourceId:'synthetic-page',version:1},documentSha256:digest,sourceSha256:digest,analysisSha256:digest,compilerSourceSha256:digest,nodes,flow:{imports:[],queries:[],mutations:[],values:[]},sourceSpans:all.map(node=>({sourceNode:node.graphKey,sourceStart:0,sourceEnd:1}))};
 return {analysis,targetRevision:NATIVE_COMPONENT_TARGET,identityBindings:all.filter(node=>node.type==='element'&&!node.control).map((node,index)=>({sourceNode:node.graphKey,sourceStart:0,sourceEnd:1,sourceSha256:digest,afId:`stable-${index}`,analysisSha256:digest,proofSha256:proof}))};
}
test('semantic layout preserves exact authored text, DOM IDs and ARIA separately from proved annotation IDs',()=>{
 const source=input([element('Card',{id:'dom-card','aria-labelledby':'heading'},[element('CardHeader',{},[element('CardTitle',{id:'heading'},[text('A < B & C\n  preserved')])]),element('Alert',{'aria-label':'Notice'},[text('Read this')])])]);
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/<section[^>]*id="dom-card"/);assert.match(result.html!,/aria-labelledby="heading"/);assert.match(result.html!,/data-af-id="stable-0"/);assert.match(result.html!,/A &lt; B &amp; C\n  preserved/);assert.doesNotMatch(result.html!,/<(?:Card|Grid|Alert)/);assert.match(result.css,/container-type:inline-size/);assert.equal(result.modules.length,0);
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
 const number=element('Number',{data:'table',col:'amount',format:',.2f',prefix:'$'});const source=input([number]);assert.ok(lowerNativeComponents(source).requirements.some(value=>value.kind==='format'));
 source.formattedValues=[{sourceNode:number.graphKey,analysisSha256:digest,formatterSha256:proof,text:'$1,234.50'}];const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/>\$1,234\.50<\/span>/);
});

test('native property shapes cannot be silently discarded by target setters',()=>{
 for(const node of [element('Segmented',{options:[{label:'Missing value'}]}),element('Textarea',{value:{unsafe:'object'}}),element('Slider',{value:'3'}),element('DataTable',{data:[]})]) {
  const result=lowerNativeComponents(input([node]));assert.equal(result.status,'blocked');assert.ok(result.blockers.some(value=>value.code==='unsupported-property-shape'));
 }
});
test('static positioned Grid uses retained 12-column coordinates and exact row rhythm',()=>{
 const result=lowerNativeComponents(input([element('Grid',{cols:12},[element('GridItem',{x:6,y:2,w:6,h:4},[text('Panel')])])]));
 assert.equal(result.status,'complete');assert.match(result.html!,/left:50%/);assert.match(result.html!,/top:172px/);assert.match(result.html!,/height:344px/);assert.match(result.html!,/height:516px/);
});
test('head title/style, hidden literals and table specs preserve retained semantics',()=>{
 const source=input([element('Helmet',{},[element('title',{},[text('Exact < title')]),element('style',{},[text('p > a { color: red }')])]),element('p',{hidden:'false'},[text('Hidden')]),element('div',{hidden:''}),element('DataTable',{height:'420px',columns:[{col:'count',title:'Count',width:80}]})]);
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.headHtml!,/Exact &lt; title/);assert.match(result.headHtml!,/p > a \{ color: red \}/);assert.match(result.html!,/<p[^>]*hidden=""/);assert.doesNotMatch(result.html!,/<div[^>]*hidden/);assert.match(result.html!,/height="420"/);assert.deepEqual(result.assignments.find(v=>v.property==='columns')?.value,[{col:'count',title:'Count',width:80}]);
});

test('retained static CSS string expressions preserve literal raw-text rather than escape CSS',()=>{
 const css:RetainedJsxNode={type:'expression',graphKey:'css-static',start:0,end:1,source:'synthetic CSS literal',value:{static:true,json:'p > a { color: red }'}};
 const result=lowerNativeComponents(input([element('Helmet',{},[element('style',{},[css])])]));assert.equal(result.status,'complete');assert.match(result.headHtml!,/p > a \{ color: red \}/);
});

test('Grid retains responsive 42rem container fallback and flow minHeight/clamping',()=>{
 const result=lowerNativeComponents(input([element('Grid',{mode:'flow',cols:12},[element('GridItem',{w:20,minHeight:120},[text('Flow')])])]));
 assert.equal(result.status,'complete');assert.match(result.html!,/grid-column:span 12/);assert.match(result.html!,/min-height:120px/);assert.match(result.css,/@container \(width < 42rem\)/);assert.match(result.css,/grid-column:span 1!important/);
});

test('Cell exact text, null, numeric coercion, aggregation and explicit d3 formatting',()=>{
 const format=(rows:Record<string,unknown>[]|null,extra={})=>formatNativeCell({rows,col:'v',format:'.2f',...extra});
 assert.deepEqual(format(null,{prefix:'$'}),{status:'formatted',text:'—'});
 for(const v of [NaN,Infinity,-Infinity,undefined])assert.deepEqual(format([{v}]),{status:'formatted',text:'—'});
 assert.deepEqual(format([{v:null}]),{status:'formatted',text:'0.00'});
 assert.deepEqual(format([{v:'  '}]),{status:'formatted',text:'0.00'});
 assert.deepEqual(format([{v:'1200'}],{format:'$,.2f'}),{status:'formatted',text:'$1,200.00'});
 assert.deepEqual(format([{v:'NaN'}],{prefix:'[',suffix:']'}),{status:'formatted',text:'[NaN]'});
 assert.deepEqual(format([{v:4},{v:2},{v:10},{v:8}],{agg:'median'}),{status:'formatted',text:'6.00'});
 assert.deepEqual(format([],{agg:'sum',prefix:'$'}),{status:'formatted',text:'$0.00'});
 assert.deepEqual(format([],{agg:'avg',prefix:'$'}),{status:'formatted',text:'$—'});
});
test('Intl default and invalid format require captured source locale, never converter defaults',()=>{
 const base={rows:[{v:1234567.891}],col:'v'};
 assert.equal(formatNativeCell(base).status,'requires-locale');assert.equal(formatNativeCell({...base,format:',0'}).status,'requires-locale');
 const localeReceipt={locale:'en-IN',numberingSystem:'latn',sourceRuntimeSha256:proof};
 assert.deepEqual(formatNativeCell({...base,localeReceipt}),{status:'formatted',text:new Intl.NumberFormat('en-IN',{numberingSystem:'latn',maximumFractionDigits:2}).format(1234567.891)});
 assert.deepEqual(formatNativeCell({...base,format:',0',localeReceipt}),formatNativeCell({...base,localeReceipt}));
});
test('Number alias never invents value/fmt/unit shorthand',()=>{
 const result=lowerNativeComponents(input([element('Number',{value:3,fmt:'.2f',unit:'USD'})]));for(const attribute of ['value','fmt','unit'])assert.ok(result.blockers.some(b=>b.attribute===attribute));
});

test('lowerer formats admitted exact table snapshots and preserves query binding requirement',()=>{
 const node=element('Cell',{data:'$table',col:'v',format:'$,.2f'}),source=input([node]);
 source.cellTables=[{sourceNode:node.graphKey,analysisSha256:digest,tableSha256:proof,rows:[{v:1234.5}]}];
 const result=lowerNativeComponents(source);assert.ok(!result.requirements.some(r=>r.kind==='format'));assert.ok(result.requirements.some(r=>r.kind==='binding'));assert.equal(result.html,null);
});
test('missing unbound Cell table renders original bare dash with placeholder chrome',()=>{
 const result=lowerNativeComponents(input([element('Cell',{prefix:'$',suffix:' units'})]));assert.equal(result.status,'complete');assert.match(result.html!,/data-mx-live=""/);assert.match(result.html!,/aria-busy="false"/);assert.match(result.html!,/<span aria-label="Number placeholder">—<\/span>/);
});
test('identity admission uses exact recovered source spans even when retained parser offsets are absent',()=>{
 const source=input([element('p')]);
 delete (source.analysis.nodes[0] as Partial<RetainedJsxNode>).start;
 delete (source.analysis.nodes[0] as Partial<RetainedJsxNode>).end;
 assert.equal(lowerNativeComponents(source).status,'complete');
 const altered=structuredClone(source);altered.identityBindings[0]!.sourceEnd=2;
 assert.ok(lowerNativeComponents(altered).blockers.some(b=>b.code==='identity-proof-required'));
 const duplicate=structuredClone(source);duplicate.analysis.sourceSpans.push({...duplicate.analysis.sourceSpans[0]!});
 assert.ok(lowerNativeComponents(duplicate).blockers.some(b=>b.code==='identity-proof-required'));
 const stale=structuredClone(source);stale.identityBindings[0]!.sourceSha256='c'.repeat(64);
 assert.ok(lowerNativeComponents(stale).blockers.some(b=>b.code==='identity-proof-required'));
});
test('admitted expression and condition targets emit exact slots and inert templates',()=>{
 const expression:RetainedJsxNode={type:'expression',graphKey:'expr',start:0,end:0,source:'$open',value:{static:false,exprType:'Identifier',source:'$open'}};
 const branch=element('__mx_condition',{},[expression]);if(branch.type!=='element')throw Error();branch.control={kind:'and',test:{kind:'signal',name:'open'}};
 const source=input([branch]);source.identityBindings=[branch,expression].map((node,i)=>({sourceNode:node.graphKey,sourceStart:0,sourceEnd:1,sourceSha256:digest,afId:`adapter-${i}`,analysisSha256:digest,proofSha256:proof}));
 source.admittedBindings=[{...source.identityBindings[0]!,kind:'condition',templateId:'template-branch'},{...source.identityBindings[1]!,kind:'text'}];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/data-af-id="adapter-0"/);assert.match(result.html!,/<template id="template-branch"><span[^>]*data-af-id="adapter-1"/);
 const stale=structuredClone(source);stale.admittedBindings![0]!.analysisSha256='f'.repeat(64);assert.equal(lowerNativeComponents(stale).status,'blocked');
});
test('admitted For preserves the source div wrapper id and class and blocks incompatible parent contexts',()=>{
 const loop=element('For',{id:'owner',className:'source-classes'},[text('Row')]);
 const source=input([loop]);source.authoredStyleSha256=digest;
 source.admittedBindings=[{...source.identityBindings[0]!,kind:'loop',templateId:'row-template',identity:{owner:'owner',keyBy:null,templateIds:['row-child'],encoding:'archived-instance-v1'}}];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/<div style="display:contents" id="owner" class="source-classes" data-af-id="stable-0"><\/div>/);assert.match(result.html!,/<template id="row-template">Row<\/template>/);
 const table=element('tbody',{},[loop]);const unsupported=input([table]);unsupported.identityBindings=source.identityBindings.concat(unsupported.identityBindings.filter(b=>b.sourceNode!==loop.graphKey));unsupported.admittedBindings=source.admittedBindings;unsupported.authoredStyleSha256=digest;
 assert.ok(lowerNativeComponents(unsupported).blockers.some(b=>b.code==='loop-wrapper-context'));
});
test('DialogTrigger retains the ordinary button type attribute contract',()=>{
 const source=input([element('Dialog',{},[element('DialogTrigger',{type:'button'},[text('Open')])])]);
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/<af-dialog-trigger[^>]*type="button"/);
 const invalid=lowerNativeComponents(input([element('Dialog',{},[element('DialogTrigger',{type:'javascript:invalid'})])]));assert.equal(invalid.status,'blocked');
});
