import test from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'acorn';
import jsx from 'acorn-jsx';
import {admitAuthorProps} from '../src/migration/conversion/compiled/author/props.ts';
const attributes=(text:string)=>(Parser.extend(jsx()).parseExpressionAt('<Component '+text+'/>',0,{ecmaVersion:'latest'}) as any).openingElement.attributes;
test('component props transfer literal JSON and top-level named bindings only',()=>{
 assert.deepEqual(admitAuthorProps(attributes('id="mount" rows={$rows} selection="$choice" settings={{limit:3,labels:["a","b"],enabled:true}} empty={null}')), {bindings:['rows','choice']});
 for(const props of ['rows={fetch("/private")}','rows={$rows.map(x=>x)}','value={$query.field}','value={window.location}','value={{constructor:1}}','value={{["x"]:1}}','{...props}','value={NaN}','value={[,1]}','value={1/0}','id={$name}','value="a" value="b"']) assert.throws(()=>admitAuthorProps(attributes(props)),props);
});
test('component JSON props have finite depth, size and count bounds',()=>{
 assert.throws(()=>admitAuthorProps(attributes('value={'+ '['.repeat(40)+'0'+']'.repeat(40)+'}')));
 assert.throws(()=>admitAuthorProps(attributes('value="'+'a'.repeat(270000)+'"')));
});

import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const authorPlan={script:'export function Widget(props){return <p>{props.label}</p>}',exports:['Widget'],mounts:[{identity:'mount',component:'Widget'}]};
test('approved component ABI bypasses native-only attribute adapters without widening native markup',()=>{
 const prefix='<Value name="label"/><Value name="rows" type="table" value={[{n:1}]}/>';
 const input={coreUrl:'/af/v1/core.js',authorPlan};
 assert.equal(admitLocalSource({...input,source:prefix+'<Widget id="mount" items={$rows} config={{limit:3,labels:["a"]}} label="$label"/>'}).ok,true);
 for(const markup of ['<div items={$rows}/>','<Widget id="mount" items={$rows.map(x=>x)}/>','<Widget id="mount" items={$missing}/>','<Widget id="mount" config={{nested:$rows}}/>','<Widget id="mount" items={window.rows}/>'])assert.equal(admitLocalSource({...input,source:prefix+markup}).ok,false,markup);
});
