import {parseFragment} from 'parse5';
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

test('removed SignIn delegates explicitly to platform menu preserving source label and identities',()=>{
 const signIn=element('SignIn',{id:'signin',className:'mt-3'},[text('Sign in to continue')]),source=input([signIn]);
 assert.ok(lowerNativeComponents(source).requirements.some(r=>r.kind==='auth'));
 source.authoredStyleSha256=digest;source.emitTextIdentities=true;
 source.identityBindings=[...source.identityBindings,{sourceNode:signIn.type==='element'?signIn.children[0]!.graphKey:'',sourceStart:0,sourceEnd:1,sourceSha256:digest,afId:'stable-label',analysisSha256:digest,proofSha256:proof}];
 source.authDelegations=[{sourceNode:signIn.graphKey,analysisSha256:digest,destination:'platform-topbar-sign-in',behavior:'platform-sign-in-replaces-embedded-auth'}];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete',JSON.stringify(result));assert.match(result.html!,/data-native-auth-delegation="platform-topbar-sign-in"/);assert.match(result.html!,/data-af-id="stable-label">Sign in to continue/);assert.match(result.html!,/use Login in the page menu/);assert.doesNotMatch(result.html!,/<button|<form|AuthSignIn/);
 source.authDelegations[0]!.analysisSha256='0'.repeat(64);assert.equal(lowerNativeComponents(source).status,'requires-adapter');
});
test('User exact person adapter consumes userId binding without leaking ID as native text',()=>{
 const user=element('User',{userId:'$_row.owner',avatar:false,fallback:'someone'}),source=input([user]);
 const binding=source.identityBindings[0]!;source.admittedBindings=[{...binding,kind:'person',attribute:'userId'}];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete',JSON.stringify(result));assert.match(result.html!,/<af-user/);assert.doesNotMatch(result.html!,/\$_row|user-id|userId/);
});

test('source-bound Button and Card recipes preserve ordinary DOM, exact merged classes and authored identities',()=>{
 const button=element('Button',{variant:'outline',size:'sm',type:'button',className:'h-auto flex-col px-2 py-2','aria-label':'Choose day'},[element('span',{},[text('Day')]),element('span',{},[text('12')])]);
 const card=element('Card',{},[element('CardHeader',{},[element('CardTitle',{},[text('Notes')])]),element('CardContent',{},[button])]);
 const source=input([card]);source.authoredStyleSha256=proof;
 const classes:Record<string,string>={Card:'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm',CardHeader:'grid gap-2 px-6',CardTitle:'leading-none font-semibold',CardContent:'px-6',Button:'inline-flex shrink-0 items-center justify-center gap-2 rounded-md border h-auto flex-col px-2 py-2'};
 const visit=(node:RetainedJsxNode):any[]=>node.type==='element'?[...(classes[node.tag]?[{sourceNode:node.graphKey,tag:node.tag,className:classes[node.tag],attributes:{'data-slot':node.tag.replace(/[A-Z]/g,(c,i)=>(i?'-':'')+c.toLowerCase()),...(node.tag==='Button'?{'data-variant':'outline','data-size':'sm'}:{})}}]:[]),...node.children.flatMap(visit)]:[];
 source.componentRecipes=visit(card);
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');
 assert.match(result.html!,/<button[^>]*data-af-id="stable-4"/);assert.match(result.html!,/aria-label="Choose day"/);assert.match(result.html!,/type="button"/);
 assert.match(result.html!,/data-slot="card"/);assert.match(result.html!,/class="flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm"/);
 assert.match(result.html!,/class="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border h-auto flex-col px-2 py-2"/);
 assert.doesNotMatch(result.html!,/af-button|native-card|<h2/);assert.deepEqual(result.modules,[]);
 const wrong={...source,componentRecipes:[{...source.componentRecipes![0]!,tag:'Button' as const}]};assert.equal(lowerNativeComponents(wrong).status,'blocked');
});

test('ordinary source buttons retain native type, disabled and ARIA plus the action flex wrapper with distinct stable structural identities',()=>{
 for(const type of ['button','submit','reset'] as const){
  const node=element('Button',{type,disabled:true,'aria-label':'Choose option','aria-describedby':'help'},[text('Choose')]),source=input([node]);source.authoredStyleSha256=proof;
  source.componentRecipes=[{sourceNode:node.graphKey,tag:'Button',className:'inline-flex flex-col',actionWrapper:'mutation-hint',attributes:{'data-slot':'button','data-size':'default','data-variant':'default'}}];
  const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,new RegExp(`type="${type}"`));assert.match(result.html!,/disabled=""/);assert.match(result.html!,/aria-label="Choose option"/);assert.match(result.html!,/aria-describedby="help"/);
  assert.match(result.html!,/^<span[^>]*class="inline-flex"><span[^>]*style="display:contents"><button/);assert.equal([...result.html!.matchAll(/data-af-id=/g)].length,3);
  const ids=[...result.html!.matchAll(/data-af-id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,3);assert.deepEqual(lowerNativeComponents(source).html,result.html);
 }
 const row=element('Button',{type:'submit'},[text('Act')]),source=input([row]);source.authoredStyleSha256=proof;source.componentRecipes=[{sourceNode:row.graphKey,tag:'Button',className:'inline-flex',attributes:{'data-slot':'button',type:'button'}}];
 assert.match(lowerNativeComponents(source).html!,/type="button"/);
});
test('structural helper identities cannot collide with an original or retired source anchor',async()=>{
 const {nativeComponentHelperIdentity}=await import('./component-presentation.ts');
 const node=element('Button',{},[text('Act')]),source=input([node]);source.authoredStyleSha256=proof;source.componentRecipes=[{sourceNode:node.graphKey,tag:'Button',className:'inline-flex',actionWrapper:'mutation-hint',attributes:{'data-slot':'button'}}];
 const helper=nativeComponentHelperIdentity(source.identityBindings[0]!.afId).trigger;
 source.reservedIdentities=[{afId:helper,sourceNode:'retired-original'}];
 const result=lowerNativeComponents(source);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(blocker=>blocker.code==='component-helper-collision'));
});
test('row URL attributes remain absent until exact typed URL adapter admission',()=>{
 const source=input([element('a',{href:'$_row.source'})]);const unbound=lowerNativeComponents(source);assert.equal(unbound.status,'requires-adapter');const binding=source.identityBindings[0]!;source.admittedBindings=[{...binding,kind:'url',attribute:'href'}];const bound=lowerNativeComponents(source);assert.equal(bound.status,'complete');assert.doesNotMatch(bound.html!,/href=|\$_row/);source.admittedBindings=[{...binding,kind:'url',attribute:'src'}];assert.equal(lowerNativeComponents(source).status,'requires-adapter');
});

test('Markdown uses exact native source property and preserves original identity without literal JSX escaping',async()=>{const {prepareNativeMarkdown}=await import('./markdown.ts');const node=element('Markdown',{'aria-label':'Prose'},[text('# Title\n\n```html\n<script>literal</script>\n```')]),source=input([node]);const identity={bindings:source.identityBindings} as unknown as Parameters<typeof prepareNativeMarkdown>[0]['identity'];source.markdown=prepareNativeMarkdown({analysis:source.analysis,identity,parserSha256:proof,parsed:[{sourceNode:node.graphKey,source:'# Title\n\n```html\n<script>literal</script>\n```',html:'<h1>Title</h1>',headings:[{level:1,title:'Title'}],errors:[]}]});const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/<af-markdown[^>]*id="native-md-stable-0"/);assert.match(result.html!,/source="# Title/);assert.doesNotMatch(result.html!,/<script>/);assert.deepEqual(result.modules.map(m=>m.name),['markdown']);assert.equal(result.identities.find(i=>i.sourceNode===node.graphKey)?.afId,'stable-0');assert.equal(lowerNativeComponents({...source,markdown:[{...source.markdown[0]!,source:'changed'}]}).status,'blocked');});

test('ordinary SVG retains namespace-sensitive attributes and text without HTML identity spans',()=>{const source=input([element('svg',{viewBox:'0 0 20 20'},[element('path',{d:'M0 0 L20 20',strokeWidth:2,fill:'none'}),element('text',{x:2,y:4,fontSize:12},[text('A < B')])])]);source.analysis.nodes.forEach(n=>{if(n.type==='element')n.isComponent=false;});source.emitTextIdentities=true;const result=lowerNativeComponents(source);assert.equal(result.status,'complete',JSON.stringify(result.blockers));assert.match(result.html!,/viewBox="0 0 20 20"/);assert.match(result.html!,/stroke-width="2"/);assert.match(result.html!,/font-size="12"/);assert.match(result.html!,/>A &lt; B<\/text>/);assert.doesNotMatch(result.html!,/<span/);});
test('metadata stays in authored Helmet and native compound tabs retain exact default selection',()=>{const source=input([element('Helmet',{},[element('meta',{name:'description',content:'A < B'})]),element('Tabs',{defaultValue:'one'},[element('TabsList',{},[element('TabsTrigger',{value:'one'},[text('One')])]),element('TabsContent',{value:'one'},[text('Panel')])])]);const result=lowerNativeComponents(source);assert.equal(result.status,'complete',JSON.stringify(result.blockers));assert.match(result.headHtml!,/<meta[^>]*name="description" content="A &lt; B">/);assert.doesNotMatch(result.html!,/<meta/);assert.match(result.html!,/<af-tabs[^>]*default-value="one"/);assert.deepEqual(result.modules.map(m=>m.name),['tabs']);assert.equal(lowerNativeComponents(input([element('meta',{name:'description',content:'body'})])).status,'blocked');});
test('Mermaid code lives only in the admitted native code attribute and never leaks literal source UI',()=>{const source=input([element('Mermaid',{title:'Map'},[text('graph TD; A-->B')])]);source.emitTextIdentities=true;const result=lowerNativeComponents(source);assert.equal(result.status,'complete',JSON.stringify(result.blockers));assert.match(result.html!,/code="graph TD; A--&gt;B"/);assert.match(result.html!,/><\/af-mermaid>/);assert.doesNotMatch(result.html!,/<span/);});


test('JSX indentation identities preserve adjacent authored siblings and retain nonvisual proof reservations',async()=>{
 const {parseFragment}=await import('parse5');
 const gap=text('\n    '),first=element('div',{className:'stat'},[text('First')]),second=element('div',{className:'stat'},[text('Second')]);
 const source=input([element('section',{},[first,gap,second])]);source.emitTextIdentities=true;source.authoredStyleSha256=digest;
 source.identityBindings=[...source.identityBindings,...source.analysis.sourceSpans.filter(span=>!source.identityBindings.some(b=>b.sourceNode===span.sourceNode)).map((span,index)=>({...span,sourceSha256:digest,analysisSha256:digest,proofSha256:proof,afId:'text-proof-'+index}))];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');
 const section=parseFragment(result.html!).childNodes[0] as any;const children=section.childNodes.filter((x:any)=>x.tagName);
 assert.deepEqual(children.map((x:any)=>x.tagName),['div','div']);
 assert.equal(children[0].attrs.find((x:any)=>x.name==='class').value,'stat');assert.equal(children[1].attrs.find((x:any)=>x.name==='class').value,'stat');
 const reserved=source.identityBindings.find(x=>x.sourceNode===gap.graphKey)!;assert.ok(result.identities.some(x=>x.sourceNode===gap.graphKey&&x.afId===reserved.afId&&x.kind==='nonvisual'));
 source.reservedIdentities=[{afId:reserved.afId,sourceNode:'removed-owner'}];assert.equal(lowerNativeComponents(source).status,'blocked');
});
test('significant inline spaces and authored multiline text remain exact identity-bearing text',()=>{
 const spaces=text(' '),crOnly=text(' \r '),prose=text('Line one\n  Line two'),source=input([element('p',{},[spaces,crOnly,prose])]);source.emitTextIdentities=true;
 source.identityBindings=[...source.identityBindings,...source.analysis.sourceSpans.filter(span=>!source.identityBindings.some(b=>b.sourceNode===span.sourceNode)).map((span,index)=>({...span,sourceSha256:digest,analysisSha256:digest,proofSha256:proof,afId:'text-proof-'+index}))];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete');assert.match(result.html!,/> <\/span>/);assert.match(result.html!,/Line one\n  Line two/);assert.equal(result.identities.filter(x=>x.kind==='text').length,3);assert.match(result.html!,/> \r <\/span>/);
});

test('exact retained Alert and Badge recipes preserve source DOM and merged styles without generic semantic defaults',()=>{
 const title=element('AlertTitle',{},[text('Note')]),description=element('AlertDescription',{},[text('Details')]),badge=element('Badge',{variant:'secondary'},[text('Status')]),alert=element('Alert',{'className':'mt-3'},[title,description]);
 const source=input([alert,badge]);source.authoredStyleSha256=proof;
 source.componentRecipes=[{sourceNode:alert.graphKey,tag:'Alert',className:'relative grid px-4 py-3 text-sm mt-3',attributes:{'data-slot':'alert'}},{sourceNode:title.graphKey,tag:'AlertTitle',className:'col-start-2 font-medium',attributes:{'data-slot':'alert-title'}},{sourceNode:description.graphKey,tag:'AlertDescription',className:'col-start-2 grid text-sm',attributes:{'data-slot':'alert-description'}},{sourceNode:badge.graphKey,tag:'Badge',className:'inline-flex rounded-full bg-secondary text-xs',attributes:{'data-slot':'badge'}}];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete',JSON.stringify(result));assert.match(result.html!,/<div[^>]*data-slot="alert"[^>]*role="alert"/);assert.match(result.html!,/<div[^>]*data-slot="alert-title"/);assert.match(result.html!,/<span[^>]*data-slot="badge"/);assert.match(result.html!,/class="inline-flex rounded-full bg-secondary text-xs"/);assert.doesNotMatch(result.html!,/native-alert|native-badge|<aside|<h3/);
 const wrong=structuredClone(source);wrong.componentRecipes![0]!.tag='Badge';assert.equal(lowerNativeComponents(wrong).status,'blocked');
 const unbound=structuredClone(source);delete unbound.authoredStyleSha256;assert.equal(lowerNativeComponents(unbound).status,'blocked');
});

test('source table recipes retain no-wrap cells and horizontal scroll container with separate helper identity',()=>{
 const cell=element('TableCell',{},[text('long visible content')]),row=element('TableRow',{},[cell]),body=element('TableBody',{},[row]),table=element('Table',{className:'mt-4'},[body]);const source=input([table]);source.authoredStyleSha256=proof;
 source.componentRecipes=[{sourceNode:table.graphKey,tag:'Table',className:'w-full caption-bottom text-sm mt-4',presentationWrapper:'table-container',attributes:{'data-slot':'table'}},{sourceNode:body.graphKey,tag:'TableBody',className:'[&_tr:last-child]:border-0',attributes:{'data-slot':'table-body'}},{sourceNode:row.graphKey,tag:'TableRow',className:'border-b transition-colors',attributes:{'data-slot':'table-row'}},{sourceNode:cell.graphKey,tag:'TableCell',className:'p-2 align-middle whitespace-nowrap',attributes:{'data-slot':'table-cell'}}];
 const result=lowerNativeComponents(source);assert.equal(result.status,'complete',JSON.stringify(result));const container:any=parseFragment(result.html!).childNodes[0],inner=container.childNodes[0];assert.equal(container.tagName,'div');assert.ok(container.attrs.some((a:any)=>a.name==='data-slot'&&a.value==='table-container'));assert.ok(container.attrs.some((a:any)=>a.name==='class'&&a.value==='relative w-full overflow-x-auto'));assert.equal(inner.tagName,'table');assert.notEqual(container.attrs.find((a:any)=>a.name==='data-af-id').value,inner.attrs.find((a:any)=>a.name==='data-af-id').value);assert.match(result.html!,/<td[^>]*class="p-2 align-middle whitespace-nowrap"/);assert.doesNotMatch(result.html!,/native-table/);
 const wrong=structuredClone(source);wrong.componentRecipes![1]!.presentationWrapper='table-container';assert.equal(lowerNativeComponents(wrong).status,'blocked');
});
