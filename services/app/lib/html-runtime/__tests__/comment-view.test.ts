import { expect, it } from 'vitest';
import { createLocalStore } from '../apollo/local-store';
import { createHtmlCommentView } from '../comment-view';
const setup = () => {
 const state = createLocalStore({ screen: 'home', draft: 'private', token: 'secret' });
 return { state, view: createHtmlCommentView({ state, declaration: { version: 'one', fields: ['screen'] }, backends: ['shared'] }) };
};
it('captures only explicit fields and restores without touching private fields', async () => {
 const {state,view}=setup();
 expect(view.capture()).toEqual({v:2,state:{$html:{version:'one',fields:{screen:'home'}}}});
 await view.restore({v:2,state:{$html:{version:'one',fields:{screen:'detail'}}}});
 expect(state.read()).toEqual({screen:'detail',draft:'private',token:'secret'});
});
it.each([
 {v:1,state:{}}, {v:2,state:{$html:{version:'old',fields:{screen:'detail'}}}},
 {v:2,state:{$html:{version:'one',fields:{draft:'exposed'}}}},
 {v:2,state:{$html:{version:'one',fields:{}}}},
 {v:2,state:{$html:{version:'one',fields:{screen:'x'.repeat(33000)}}}},
])('refuses malformed, incompatible, missing or oversized snapshots atomically', async saved => {
 const {state,view}=setup(); await expect(view.restore(saved)).rejects.toThrow(); expect(state.read().screen).toBe('home');
});
it('rejects backend names and invalid declarations', () => {
 const state=createLocalStore({});
 expect(()=>createHtmlCommentView({state,declaration:{version:'one',fields:['shared']},backends:['shared']})).toThrow();
});

import { createHtmlCommentViewSession, installHtmlCommentView, withHtmlCommentView } from '../../html-bridge/comment-view-session';
it('restores on open and explicit request only, and returns private view on close', async () => {
 const {state,view}=setup(); const owner={}; installHtmlCommentView(owner,view); const session=createHtmlCommentViewSession(owner);
 const command={openId:'thread',pins:[{id:'thread',viewState:{v:2,state:{$html:{version:'one',fields:{screen:'detail'}}}}}]};
 await session.receive(command);expect(state.read().screen).toBe('detail');
 await state.write({expected:{screen:'detail'},next:{screen:'chosen'}});
 await session.receive(command);expect(state.read().screen).toBe('chosen');
 await session.receive({...command,viewStateRequest:1});expect(state.read().screen).toBe('detail');
 await session.receive({openId:null});expect(state.read().screen).toBe('home');
 expect(state.read().draft).toBe('private');
});
it('preserves deliberate changes on return, and reports incompatible or undeclared views', async () => {
 const {state,view}=setup(); const owner={};installHtmlCommentView(owner,view);const session=createHtmlCommentViewSession(owner);
 await session.receive({openId:'a',pins:[{id:'a',viewState:{v:2,state:{$html:{version:'one',fields:{screen:'detail'}}}}}]});
 await state.write({expected:{screen:'detail'},next:{screen:'chosen'}});
 await session.receive({openId:null});expect(state.read().screen).toBe('chosen');
 await session.receive({openId:'bad',pins:[{id:'bad',viewState:{v:1,state:{}}}]});expect(session.error?.id).toBe('bad');
 const undeclared=createHtmlCommentViewSession({});await undeclared.receive({openId:'a',pins:[{id:'a',viewState:{v:2,state:{}}}]});expect(undeclared.error?.id).toBe('a');
 expect(withHtmlCommentView({}, {path:'stale-anchor'})).toEqual({path:'stale-anchor'});
 expect(withHtmlCommentView(owner,{path:'stale-anchor'}).viewState?.state).not.toHaveProperty('draft');
});
it('rejects unsafe, duplicate, empty and backend declarations', () => {
 for(const fields of [['__proto__'],['constructor'],['screen','screen'],[],['shared']]){
  expect(()=>createHtmlCommentView({state:createLocalStore({}),backends:['shared'],declaration:{version:'one',fields}})).toThrow();
 }
});
it('reports failed capture without attaching incomplete or oversized state', () => {
 const cases:Record<string,string>[]=[{draft:'private'},{screen:'x'.repeat(33000),draft:'private'}];
 for(const initial of cases) {
  const owner={};installHtmlCommentView(owner,createHtmlCommentView({state:createLocalStore(initial),backends:[],declaration:{version:'one',fields:['screen']}}));
  expect(withHtmlCommentView(owner,{path:'target'})).toEqual({path:'target',viewStateError:expect.any(String)});
 }
});

import { commentViewDeclaration } from '../comment-view';
const block=(initial:Record<string,unknown>,attributes:Record<string,string>={})=>({initial,attribute:(name:string)=>attributes[name]??null});
const defaults=(initial:Record<string,ReviewJsonish>,attributes:Record<string,string>={},backends:string[]=[])=>{
 const state=createLocalStore(initial); return {state,view:createHtmlCommentView({state,backends,declaration:commentViewDeclaration(block(initial,attributes),backends)!})};
};
type ReviewJsonish=null|boolean|number|string|ReviewJsonish[]|{[key:string]:ReviewJsonish};
const html=(saved:ReturnType<ReturnType<typeof createHtmlCommentView>['capture']>)=>saved?.state.$html as {version:string;fields:Record<string,unknown>};
it('captures every authored top-level field by default, minus the exclude list and backend namespaces', async () => {
 const {state,view}=defaults({tab:'a',dark:true,draft:'typed',shared:{}},{'data-af-comment-exclude':'["draft"]'},['shared']);
 expect(Object.keys(html(view.capture()).fields).sort()).toEqual(['dark','tab']);
 expect(html(view.capture()).version).toMatch(/^auto-[0-9a-f]{8}$/);
 const saved=view.capture();
 await state.write({expected:{tab:'a',draft:'typed'},next:{tab:'b',draft:'mine'}});
 await view.restore(saved);
 expect(state.read()).toMatchObject({tab:'a',dark:true,draft:'mine'});
});
it('lets explicit fields win over the default and the exclude list', () => {
 const {view}=defaults({tab:'a',draft:'typed'},{'data-af-comment-fields':'["draft"]','data-af-comment-exclude':'["draft"]','data-af-comment-version':'one'});
 expect(view.capture()).toEqual({v:2,state:{$html:{version:'one',fields:{draft:'typed'}}}});
});
it('derives a version from the field names that refuses views saved for another field set', async () => {
 const before=defaults({tab:'a',month:'may'}).view.capture();
 const reordered=defaults({month:'june',tab:'b'});
 expect(html(reordered.view.capture()).version).toBe(html(before).version);
 await reordered.view.restore(before); expect(reordered.state.read()).toEqual({month:'may',tab:'a'});
 const changed=defaults({tab:'b',month:'june',metric:'x'});
 await expect(changed.view.restore(before)).rejects.toThrow(); expect(changed.state.read().tab).toBe('b');
 const explicit=defaults({tab:'a'},{'data-af-comment-fields':'["tab"]'}).view.capture();
 expect(html(explicit).version).toBe(html(defaults({tab:'a'}).view.capture()).version);
});
it('drops default fields that do not fit the bounds instead of failing the comment', async () => {
 const deep:ReviewJsonish=JSON.parse('['.repeat(20)+']'.repeat(20));
 const {state,view}=defaults({tab:'a',rows:'x'.repeat(33000),tree:deep,list:Array.from({length:5000},()=>1)});
 const saved=view.capture();
 expect(html(saved).fields).toEqual({tab:'a'});
 await state.write({expected:{tab:'a'},next:{tab:'b'}});await view.restore(saved);expect(state.read().tab).toBe('a');
 expect(defaults({rows:'x'.repeat(33000)}).view.capture()).toBeNull();
 const owner={};installHtmlCommentView(owner,defaults({rows:'x'.repeat(33000)}).view);
 expect(withHtmlCommentView(owner,{path:'target'})).toEqual({path:'target'});
});
it('installs no default view when nothing is eligible, and fails closed on an invalid exclude list', () => {
 expect(commentViewDeclaration(block({draft:''},{'data-af-comment-exclude':'["draft"]'}),[])).toBeUndefined();
 expect(commentViewDeclaration(block({shared:{}}),['shared'])).toBeUndefined();
 for(const exclude of ['draft','["draft","draft"]','[1]','["__proto__"]'])
  expect(()=>commentViewDeclaration(block({tab:'a',draft:''},{'data-af-comment-exclude':exclude}),[])).toThrow();
});
