import { expect, it } from 'vitest';
import { createLocalStore } from '../apollo/client';
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
