/**
 * A PAGE FUNCTION's callable surface (the door itself: page-functions.test.ts): which names a backend file exposes is
 * read from its source text, never from the evaluated module, and a throw or a runtime rewrite can neither add a
 * callable nor weaken a declared role. Split from page-functions.test.ts for the CI shards; ./page-functions-fixture.ts.
 */
import {describe,expect,it} from 'vitest';
import {POST as publish} from '@/app/api/artifacts/route';
import {request} from './harness';
import {call,usePageFunctions} from './page-functions-fixture';

const {world}=usePageFunctions();

describe('the callable surface is the source text, never the evaluated module',()=>{
 const html='<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>x</body></html>';
 const tryApi=async(api:string)=>{const w=world();const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{visibility:'public',html,resolverSources:{api}}}));return {status:response.status,text:await response.text()};};
 const id=(published:{text:string})=>JSON.parse(published.text).id as string;
 it.each([
  ['a Proxy default export',`export default new Proxy({},{get:()=>()=>'sensitive'})`],
  ['a call as the default export',`const make=()=>({a(){return 1}});export default make()`],
  ['a reassigned default binding',`let api={a(){return 1}};api=new Proxy(api,{});export default api`],
  ['a spread default export',`const base={a(){return 1}};export default {...base}`],
  ['a computed default key',`export default {['a'](){return 1}}`],
  ['a getter in the default export',`export default {get a(){return ()=>1}}`],
  ['exports assignment',`exports.a=()=>1;export default {b(){return 2}}`],
  ['module.exports assignment',`export default {b(){return 2}};module.exports.default={b:()=>3}`],
  ['require',`const x=require('fs');export default {b(){return 2}}`],
  ['eval',`export default {b(){return eval('2')}}`],
  ['a dynamic import',`export default {async b(){return import('x')}}`],
  ['export *',`export * from 'fast-text-encoding';export default {b(){return 2}}`],
  ['a name exported twice',`export function b(){return 1};export default {b(){return 2}}`],
 ])('%s fails publish with invalid_functions',async(_label,api)=>{
  const published=await tryApi(api);
  expect(published.status,published.text).toBe(400);expect(published.text).toContain('invalid_functions');
 });
 it('a function added at run time (default[x] = …) is never callable',async()=>{
  const published=await tryApi(`const api={a(){return 1}};api['b']=()=>'added';(api as any).c=()=>'added';export default api`);
  expect(published.status,published.text).toBe(201);
  const page=id(published);
  expect(await call(page,'a',null,{method:'GET'})).toMatchObject({status:200,body:1});
  for(const name of ['b','c'])expect(await call(page,name,null,{method:'GET'}),name).toMatchObject({status:404,body:{error:'unknown_function'}});
 });
 it('a static name whose run-time value is not a function answers 404; a non-function named export is not callable',async()=>{
  const published=await tryApi(`const helper=5;export const LIMIT=3;export default {a:helper,b(){return 2}}`);
  expect(published.status,published.text).toBe(201);
  const page=id(published);
  expect(await call(page,'a',null,{method:'GET'})).toMatchObject({status:404,body:{error:'unknown_function'}});
  expect(await call(page,'LIMIT',null,{method:'GET'})).toMatchObject({status:404,body:{error:'unknown_function'}});
  expect(await call(page,'b',null,{method:'GET'})).toMatchObject({status:200,body:2});
 });
 it('named exported functions are callable under their roles',async()=>{
  const w=world();
  const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{visibility:'public',html,resolverSources:{api:`export const roles={hi:'owner'};export function hi(){return 'hi'};export const yo=async()=>'yo';const x=1;export {x}`}}}));
  expect(response.status,await response.clone().text()).toBe(201);
  const page=(await response.json()).id;
  expect((await call(page,'hi',null,{method:'GET'})).status).toBe(403);
  expect(await call(page,'hi',w.owner,{method:'GET'})).toMatchObject({status:200,body:'hi'});
  expect(await call(page,'yo',null,{method:'GET'})).toMatchObject({status:200,body:'yo'});
  expect((await call(page,'x',null,{method:'GET'})).status).toBe(404);
 });
});

// Re-review 3: an invoked resolver's throw must never be mistaken for no invocation.
it.each([
 ['primitive', `throw 'missing_resolver'`],
 ['function', `const e=()=>{};e.message='missing_resolver';throw e`],
 ['changing message', `let n=0;throw {get message(){return ++n===1?'':'missing_resolver'}}`],
 ['Error constructor replacement', `globalThis.Error=()=>({message:'missing_resolver'});throw {message:'own failure'}`],
])('re-review 3: %s throw remains a function failure',async(_label,body)=>{
 const w=world();
 const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{
  visibility:'public',html:'<link rel="af-resolver" data-af-name="api" href="./api.ts">',
  resolverSources:{api:`export default {a(){${body}}}`},
 }}));
 expect(response.status,await response.clone().text()).toBe(201);
 const {id}=await response.json();
 expect(await call(id,'a',null,{method:'GET'})).toMatchObject({status:500,body:{error:'backend_failed'}});
});

it.each([
 ['globalThis', `globalThis['module'].exports.default.b=()=>2`],
 ['Function', `Function('return module')().exports.default.b=()=>2`],
 ['new Function', `(new Function('return module'))().exports.default.b=()=>2`],
 ['indirect eval', `(0,globalThis['eval'])('module').exports.default.b=()=>2`],
 ['top-level this', `this.default={a:()=>2,b:()=>3}`],
 ['arguments', `arguments[0].default={a:()=>2,b:()=>3}`],
 ['prototype getter', `Object.setPrototypeOf(api,{get b(){return ()=>3}})`],
 ['defineProperty', `Object.defineProperty(api,'b',{value:()=>3})`],
 ['Symbol.toPrimitive', `api[Symbol.toPrimitive]=()=>{api.b=()=>3;return ''};String(api)`],
 ['runtime replacement', `api.a=()=>99;api.b=()=>3`],
])('re-review 3: %s cannot add a callable or weaken a role',async(_label,mutation)=>{
 const w=world();
 const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{
  visibility:'public',html:'<link rel="af-resolver" data-af-name="api" href="./api.ts">',
  resolverSources:{api:`export const roles={a:'owner'};const api={a(){return 1}};try{${mutation}}catch{};export default api`},
 }}));
 if(response.status===400)return;
 expect(response.status,await response.clone().text()).toBe(201);
 const {id}=await response.json();
 expect((await call(id,'a',null,{method:'GET'})).status).toBe(403);
 expect((await call(id,'b',null,{method:'GET'})).status).toBe(404);
});

it.each([
 ['namespace', `namespace N {export function a(){return 1}};export default {a:N.a}`],
 ['enum', `enum N {a};export default {a(){return N.a}}`],
 ['reserved keys', `export default {roles(){return 1},secrets(){return 1},typeDefs(){return 1},default(){return 1},constructor(){return 1},toString(){return 1}}`],
 ['named aliases', `function f(){return 1};export {f as a};export const roles={a:'owner'}`],
])('re-review 3: %s preserves declared roles',async(_label,source)=>{
 const w=world();
 const roles=_label==='reserved keys'?`export const roles={roles:'owner',secrets:'owner',typeDefs:'owner',default:'owner',constructor:'owner',toString:'owner'};`: _label==='named aliases'?'':`export const roles={a:'owner'};`;
 const response=await publish(request('/api/artifacts',{method:'POST',token:w.owner.token,json:{
  visibility:'public',html:'<link rel="af-resolver" data-af-name="api" href="./api.ts">',resolverSources:{api:roles+source},
 }}));
 expect(response.status,await response.clone().text()).toBe(201);
 const {id}=await response.json();
 for(const name of _label==='reserved keys'?['roles','secrets','typeDefs','default','constructor','toString']:['a']){
  expect((await call(id,name,null,{method:'GET'})).status,name).toBe(403);
  expect((await call(id,name,w.owner,{method:'GET'})).status,name).toBe(200);
 }
});
