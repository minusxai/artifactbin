/** Catch broken inline modules before the installed-preview browser gate waits on their output. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

const source=readFileSync(new URL('../fixtures/local-preview.mjs',import.meta.url),'utf8');
for(const [name,output,button] of [['html','#count','#increment'],['portableSource','#private-count','#private-increment']]) {
 const html=source.match(new RegExp('const '+name+'=`([\\s\\S]*?)`;'))?.[1];
 const script=html?.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 it(`${name} draws initial state and updates after its button is pressed`,async()=>{
  expect(script).toBeTypeOf('string');
  const nodes=new Map();const document={querySelector:selector=>{
   if(!nodes.has(selector))nodes.set(selector,{textContent:''});return nodes.get(selector);
  }};
  let value={count:0},listener;
  const state={getState:()=>value,subscribe:fn=>{listener=fn;},setState:fn=>{value=fn(value);listener?.(value);}};
  const body=script.replace(/import [^;]+;/g,'');
  const execute=new Function('state','document','fetch','first','later','chart',`return (async()=>{${body}})()`);
  await execute(state,document,async()=>({json:async()=>[7]}),1,async()=>({second:()=>2,readCycle:()=>7}),async()=>{});
  expect(document.querySelector(output).textContent).toBe('0');
  document.querySelector(button).onclick();
  expect(document.querySelector(output).textContent).toBe('1');
 });
}
