import {describe,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {installPerformanceUsefulObserver} from '../lib/performance-useful.mjs';

async function probe(markup,path='/') {
 const dom=new JSDOM('<!doctype html>',{url:'http://localhost'+path,runScripts:'outside-only'});
 const frames=[];dom.window.requestAnimationFrame=callback=>frames.push(callback);
 dom.window.eval(`(${installPerformanceUsefulObserver.toString()})()`);
 dom.window.document.body.innerHTML=markup;
 await Promise.resolve();
 const before=dom.window.__performanceUseful;
 for(let frame=0;frame<2;frame++){const pending=frames.splice(0);pending.forEach(callback=>callback());}
 const result={before,useful:dom.window.__performanceUseful};dom.window.close();return result;
}
describe('timing lab useful content observation',()=>{
 it('marks the current home grid with an empty accessible cover link and sibling title after two frames',async()=>{
  const result=await probe('<div class="artifact-cover"><a href="/a/fixture" aria-label="Open Workspace sample 38"></a><span>Workspace sample 38</span></div>');
  expect(result.before).toBeNull();expect(result.useful).toEqual(expect.any(Number));
 });
 it('marks the list view through the same accessible document link',async()=>{
  expect((await probe('<a href="/a/fixture" aria-label="Open Workspace sample 38"><span>Workspace sample 38</span></a>')).useful).toEqual(expect.any(Number));
 });
 it('does not mark a skeleton, unrelated link or matching text without a document door',async()=>{
  for(const html of ['<div>Loading</div>','<a href="/settings">Workspace sample settings</a>','<span>Workspace sample 38</span>'])expect((await probe(html)).useful).toBeNull();
 });
 it('does not mistake another route for the home fixture',async()=>{
  expect((await probe('<a href="/a/fixture" aria-label="Open Workspace sample 38"></a>','/login')).useful).toBeNull();
 });
 it('retains the actual prose heading readiness',async()=>{
  expect((await probe('<h1>Performance fixture</h1>','/a/fixture')).useful).toEqual(expect.any(Number));
 });
});
