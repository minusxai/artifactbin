import test from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'acorn';
import jsx from 'acorn-jsx';
import {admitAuthorProps,reconcileAuthorProps} from '../src/migration/conversion/compiled/author/props.ts';
const attributes=(text:string)=>(Parser.extend(jsx()).parseExpressionAt('<Component '+text+'/>',0,{ecmaVersion:'latest'}) as any).openingElement.attributes;
test('component props transfer literal JSON and top-level named bindings only',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(admitAuthorProps(attributes('id="mount" rows={$rows} selection="$choice" settings={{limit:3,labels:["a","b"],enabled:true}} empty={null}')))), {identity:'mount',props:{settings:{limit:3,labels:['a','b'],enabled:true},empty:null},bindings:{rows:'rows',selection:'choice'}});
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

test('transferred component props and binding metadata reconcile exact JSON without key-order dependence',()=>{
 const expected={...admitAuthorProps(attributes('id="mount" rows={$rows} config={{limit:3,labels:["a"]}}')),identity:'mount',component:'Widget'};
 assert.equal(reconcileAuthorProps(expected,{config:{labels:['a'],limit:3}},{rows:'rows'}),true);
 for(const [props,bindings] of [[{config:{limit:4,labels:['a']}},{rows:'rows'}],[{config:{limit:3,labels:['a']}},{rows:'missing'}],[{config:{limit:3,labels:['a']}},{}],[{config:{limit:3,labels:['a']},extra:1},{rows:'rows'}],[{config:{limit:3,labels:['a']},bad:Infinity},{rows:'rows'}],[JSON.parse('{"__proto__":1}'),{rows:'rows'}]])assert.equal(reconcileAuthorProps(expected,props,bindings),false);
});

import {admitLocalOutput} from '../src/migration/conversion/compiled/local-output.ts';
test('compiler mount output must preserve exact source props and referenced bindings',()=>{
 const source='<Value name="label"/><Widget id="mount" label="$label" config={{limit:3,labels:["a"]}}/>';
 const admitted=admitLocalSource({source,coreUrl:'/af/v1/core.js',authorPlan});assert.ok(admitted.ok);
 const attr=(value:unknown)=>JSON.stringify(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
 const mount=(props:unknown,bindings:unknown,id='mount')=>'<div id="'+id+'" data-migration-author-component="Widget" data-migration-author-props="'+attr(props)+'" data-migration-author-bind="'+attr(bindings)+'"></div>';
 const output={html:mount({config:{labels:['a'],limit:3}},{label:'label'}),css:'',title:'Example',build:'synthetic',rootAttributes:{class:'light'},modules:[],javascript:'void 0;',declarations:[{name:'label',type:'string',default:null}],authorExports:['Widget'],capabilities:[]};
 assert.equal(admitLocalOutput(admitted.plan,output).ok,true);
 for(const html of [mount({config:{limit:4,labels:['a']}},{label:'label'}),mount({config:{limit:3,labels:['a']}},{label:'missing'}),mount({config:{limit:3,labels:['a']}},{}),output.html+output.html,mount({config:{limit:3,labels:['a']}},{label:'label'},'replacement'),'<p id="mount">native replacement</p>'])assert.equal(admitLocalOutput(admitted.plan,{...output,html}).ok,false);
});

test('claimed author exports cannot bypass native or audited kit admission',()=>{
 for(const component of ['div','Button','Tooltip']) {
  const candidate={script:'export function Widget(){return null}',exports:[component],mounts:[{identity:'mount',component}]};
  assert.equal(admitLocalSource({coreUrl:'/af/v1/core.js',authorPlan:candidate,source:'<Value name="rows" type="table" value={[{n:1}]}/><'+component+' id="mount" items={$rows}/>'}).ok,false);
 }
});
