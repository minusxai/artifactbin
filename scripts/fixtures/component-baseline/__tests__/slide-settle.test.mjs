import {describe,it,expect} from 'vitest';
import {settleSlideGeometry,settleInteraction} from '../interaction.mjs';
function clock(sample){let time=0;return {implementation:'jsx',timeoutMs:600,stableMs:100,sample:()=>sample(time),now:()=>time,nextFrame:async()=>{time+=20;},read:()=>time};}
describe('slide capture geometry settlement',()=>{
  it('waits past a selected counter while smooth scroll still moves',async()=>{const c=clock(t=>[t<200?200-t:0,0]);await settleSlideGeometry(c);expect(c.read()).toBeGreaterThanOrEqual(300);});
  it('accepts stationary geometry only after a stable interval',async()=>{const c=clock(()=>[0,800,400]);await settleSlideGeometry(c);expect(c.read()).toBe(100);});
  it('does not accumulate sub-tolerance movement as stability',async()=>{const c=clock(t=>[t/100]);await expect(settleSlideGeometry(c)).rejects.toThrow(/settle/);expect(c.read()).toBe(600);});
  it('times out missing or continuously moving targets',async()=>{for(const sample of [()=>null,t=>[t]]){const c=clock(sample);await expect(settleSlideGeometry(c)).rejects.toThrow(/settle/);expect(c.read()).toBe(600);}});
  it('restarts stability when selected slide disappears',async()=>{const c=clock(t=>t===80?null:[0]);await settleSlideGeometry(c);expect(c.read()).toBe(200);});
  it('bounds suspended animation frames with a wall timeout',async()=>{await expect(settleSlideGeometry({implementation:'jsx',timeoutMs:20,sample:()=>[0],nextFrame:()=>new Promise(()=>{})})).rejects.toThrow(/settle/);});
  it('samples the original document slide rather than its rail thumbnails',async()=>{
    const {JSDOM}=await import('jsdom');const dom=new JSDOM('<nav><div data-mx-slide></div><div data-mx-slide></div></nav><main class="mx-doc"><section data-mx-slide></section><section data-mx-slide></section></main>');
    const saved={document:globalThis.document,window:globalThis.window};globalThis.document=dom.window.document;globalThis.window=dom.window;
    let samples=0;dom.window.document.querySelectorAll('.mx-doc [data-mx-slide]')[1].getBoundingClientRect=()=>{samples++;return {top:0,left:0,width:800,height:600};};
    const c=clock(()=>null);delete c.sample;
    try{await settleSlideGeometry(c);expect(samples).toBeGreaterThan(3);}finally{Object.assign(globalThis,saved);dom.window.close();}
  });
  it('runs the geometry check in the actual frame after selection',async()=>{const calls=[];await settleInteraction({fixture:{id:'slides-two'},action:{action:'click',name:'Next slide'},implementation:'html',frame:{waitForFunction:async()=>calls.push('selected'),evaluate:async(fn,arg)=>calls.push([fn,arg])}});expect(calls).toEqual(['selected',[settleSlideGeometry,{implementation:'html'}]]);});
});
