import test from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'acorn';
import {readLocalReactiveExpression} from '../src/migration/conversion/compiled/reactive-source.ts';
const parse=(source:string)=>Parser.parseExpressionAt(source,0,{ecmaVersion:'latest'});
test('read expressions admit only the archived pure scalar vocabulary and own query cells',()=>{
  const good=readLocalReactiveExpression(parse('$count === 2 && !$summary.empty'));
  assert.ok(good);
  assert.deepEqual(good.signals,['count','summary.empty']);
  for(const source of ['run($count)','$count = 2','window.x','$summary["empty"]','$summary.constructor','$summary.__proto__','$summary.x.y','$count == 2','$count + 1','new Date()','(()=>1)()']) assert.equal(readLocalReactiveExpression(parse(source)),null,source);
});
test('reactive depth is bounded and row scope remains explicit',()=>{
  assert.deepEqual(readLocalReactiveExpression(parse('$_row.label'))?.rowFields,['label']);
  assert.equal(readLocalReactiveExpression(parse('!'.repeat(40)+'$count')),null);
});

import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const base={coreUrl:'/af/v1/core.js'};
const prefix='<Value name="mode" type="string" default="a"/><Value name="rows" type="table" value={[{key:"a",label:"First"}]}/><Query name="summary">{`select 1 as n`}</Query>';
test('source admission records conditional and stable keyed identity regions without trusting supplied plans',()=>{
  const result=admitLocalSource({...base,source:prefix+'{$mode === "a" ? <p id="yes">{$summary.n}</p> : <p id="no">hidden</p>}<For id="list" each={$rows} keyBy="key"><span id="item">{$_row.label}</span></For>',dynamicIdentities:{regions:[{kind:'node',id:'forged'}]}});
  assert.ok(result.ok);
  assert.equal(result.plan.input.dynamicIdentities,result.plan.dynamicIdentities);
  assert.deepEqual(result.plan.dynamicIdentities.regions,[
    {kind:'conditional',test:{kind:'binary',op:'===',left:{kind:'signal',name:'mode'},right:{kind:'literal',value:'a'}},yes:[{kind:'node',id:'yes'}],no:[{kind:'node',id:'no'}]},
    {kind:'repeat',owner:'list',table:'rows',keyBy:'key',children:[{kind:'node',id:'item'}]},
  ]);
});
test('source admission refuses ambient execution, unresolved cells, unscoped rows and unstable loops',()=>{
  for(const markup of [
    '{$rows && <p>not scalar</p>}', '{$summary ? <p>not scalar</p> : <span>other</span>}', '{$summary.n ? <p>not admitted</p> : <span>other</span>}', '{window.location}', '{$summary["n"]}', '{$mode.constructor}', '{$mode.n}', '{$_row.label}',
    '{$mode == "a" && <p>bad</p>}', '{fetch("/secret") && <p>bad</p>}',
    '<For each={$rows}><span>bad</span></For>', '<For id="list" each={$rows} keyBy="missing"><span>bad</span></For>', '<For id="list" each={$rows} keyBy="key"><span>{$_row.missing}</span></For>', '<For id="list" each={$mode} keyBy="key"><span>bad</span></For>',
    '<For id="list" each={$rows} keyBy="key"><For id="nested" each={$rows} keyBy="key"><span>bad</span></For></For>',
  ]) assert.equal(admitLocalSource({...base,source:prefix+markup}).ok,false,markup);
});

test('read-only column markup preserves headers separately from durable cell instances',()=>{
  const result=admitLocalSource({...base,source:prefix+'<DataTable id="table" data="$rows" rowKey="key"><Column id="header" col="label" title="Label"><span id="cell">{$_row.label}</span></Column></DataTable>'});
  assert.ok(result.ok);
  assert.deepEqual(result.plan.dynamicIdentities.regions,[{kind:'node',id:'table'},{kind:'node',id:'header'},{kind:'cell',owner:'table',table:'rows',rowKey:'key',column:'label',children:[{kind:'node',id:'cell'}]}]);
  for(const markup of [
    '<Column col="label"><span>{$_row.label}</span></Column>',
    '<DataTable id="table" data="$rows" rowKey="key"><Column col="label" col="key"/></DataTable>',
    '<DataTable id="table" data="$rows" rowKey="key"><Column col="label" hasContent/></DataTable>',
    '<DataTable id="table" data="$rows" rowKey="key"><p>mixed child</p></DataTable>',
    '<DataTable id="table" data="$rows"><Column col="label"><span>{$_row.label}</span></Column></DataTable>',
    '<DataTable id="table" data="$rows" rowKey="key"><Column col="label"><Button args={{mode:"b"}}>write</Button></Column></DataTable>',
    '<DataTable id="table" data="$rows" rowKey="key"><Column col="label"><span>{$_row.missing}</span></Column></DataTable>',
  ])assert.equal(admitLocalSource({...base,source:prefix+markup}).ok,false,markup);
});

 test('source admission trusts normalized omitted and temporal Value declarations',()=>{
  for(const markup of ['<Value name="text" default="hello"/>','<Value name="when" type="date"/>','<Value name="person" type="user"/>']) assert.equal(admitLocalSource({...base,source:markup}).ok,true,markup);
  for(const markup of ['<Value name="bad" type="unknown"/>','<Value name="bound" source="$other" column="name"/>']) assert.equal(admitLocalSource({...base,source:markup}).ok,false,markup);
 });

test('viewer scalar controls require matching declared types and bounded literal configuration',()=>{
 const values='<Value name="choice" default="a"/><Value name="enabled" type="boolean"/><Value name="amount" type="number"/>';
 for(const markup of ['<Segmented value="$choice" options={["a","b"]}/>','<Switch checked="$enabled"/>','<Slider value="$amount" min={0} max={10} step={1}/>'])assert.equal(admitLocalSource({...base,source:values+markup}).ok,true,markup);
 for(const markup of ['<Segmented value="$amount" options={["a"]}/>','<Switch checked="$choice"/>','<Slider value="$enabled"/>','<Slider value="$amount" step={0}/>','<Switch checked="$enabled" onChange="evil"/>','<Segmented value="$choice" options={["a"]}><span>ignored</span></Segmented>'])assert.equal(admitLocalSource({...base,source:values+markup}).ok,false,markup);
 const result=admitLocalSource({...base,source:values+'<Segmented value="$choice" options={["a","b"]}/>'});
 assert.ok(result.ok);assert.equal(result.plan.input.dataControls?.[0]?.kind,'select');
});

test('registered row mutations require a durable renderer row scope and existing fields',()=>{
 const binding={name:'items',legacyRef:'ref:Abcd12',backendNamespace:'legacyData',backendHref:'/af/v1/ids/Bac123',version:1,mode:'live' as const,tables:[{schema:'public',table:'rows',columns:[{name:'key',type:'string'}]}]};
 const metadata={name:'save',backendNamespace:'legacyData',recoveryScope:'a'.repeat(64),paramTypes:{},rowParams:{key:{param:'row__key',type:'string' as const}}};
 const head='<Import name="items" src="ref:Abcd12"/><Value name="rows" type="table" value={[{key:"a",label:"First"}]}/><Mutation name="save">{`delete from items.rows where key=$_row.key`}</Mutation>';
 const input={...base,datasetBindings:[binding],datasetMutations:[metadata]};
 for(const body of ['<For id="list" each={$rows} keyBy="key"><Button id="action" run="$save">Delete</Button></For>','<DataTable id="table" data="$rows" rowKey="key"><Column col="label"><Button id="action" run="$save">Delete</Button></Column></DataTable>'])assert.equal(admitLocalSource({...input,source:head+body}).ok,true,body);
 assert.equal(admitLocalSource({...input,source:head+'<Button run="$save">Delete</Button>'}).ok,false);
 assert.equal(admitLocalSource({...input,datasetMutations:[{...metadata,rowParams:{missing:{param:'row__missing',type:null}}}],source:head+'<For id="list" each={$rows} keyBy="key"><Button run="$save">Delete</Button></For>'}).ok,false);
});

test('presentation kit admission requires exact context and literal audited props',()=>{
 const head='<Value name="n" type="number"/>';
 for(const body of ['<Tooltip id="tip"><TooltipTrigger id="trigger">Help</TooltipTrigger><TooltipContent id="content">Details</TooltipContent></Tooltip>','<Dialog id="dialog"><DialogTrigger>Open</DialogTrigger><DialogContent><DialogClose>Close</DialogClose></DialogContent></Dialog>','<Avatar><AvatarFallback>AB</AvatarFallback></Avatar>'])assert.equal(admitLocalSource({...base,source:head+body}).ok,true,body);
 for(const body of ['<TooltipTrigger>Missing context</TooltipTrigger>','<Dialog><DialogContent run="$save"/></Dialog>','<Tooltip open="$n"/>','<Accordion type="multiple"/>','<Avatar onClick="evil"/>'])assert.equal(admitLocalSource({...base,source:head+body}).ok,false,body);
});

test('presentation identity hosts are derived from source and replace supplied hosts',()=>{
 const result=admitLocalSource({...base,source:'<Value name="n" type="number"/><Tooltip id="tip"><TooltipTrigger>Help</TooltipTrigger><TooltipContent>Details</TooltipContent></Tooltip>',presentationIdentities:[{tag:'Tooltip',id:'forged'}]});
 assert.ok(result.ok);assert.deepEqual(result.plan.input.presentationIdentities,[{tag:'Tooltip',id:'tip'}]);
});

test('row buttons may update viewer-local declared scalar state using scoped row fields',()=>{
 const head='<Value name="selected"/><Value name="rows" type="table" value={[{key:"a",label:"First"}]}/>';
 const body=(set:string)=>'<DataTable id="table" data="$rows" rowKey="key"><Column col="label"><Button id="pick" set={'+set+'}>Pick</Button></Column></DataTable>';
 assert.equal(admitLocalSource({...base,source:head+body('{selected:"$_row.label"}')}).ok,true);
 for(const value of ['{selected:"$_row.missing"}','{missing:"$_row.label"}','{selected:"$_value"}','{selected:"$_row.constructor"}'])assert.equal(admitLocalSource({...base,source:head+body(value)}).ok,false,value);
 assert.equal(admitLocalSource({...base,source:head+'<Button set={{selected:"$_row.label"}}>Pick</Button>'}).ok,false);
});
