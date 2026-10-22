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
    '{$summary.n ? <p>not admitted</p> : <span>other</span>}', '{window.location}', '{$summary["n"]}', '{$mode.constructor}', '{$mode.n}', '{$_row.label}',
    '{$mode == "a" && <p>bad</p>}', '{fetch("/secret") && <p>bad</p>}',
    '<For each={$rows}><span>bad</span></For>', '<For id="list" each={$rows} keyBy="missing"><span>bad</span></For>', '<For id="list" each={$rows} keyBy="key"><span>{$_row.missing}</span></For>', '<For id="list" each={$mode} keyBy="key"><span>bad</span></For>',
    '<For id="list" each={$rows} keyBy="key"><For id="nested" each={$rows} keyBy="key"><span>bad</span></For></For>',
  ]) assert.equal(admitLocalSource({...base,source:prefix+markup}).ok,false,markup);
});
