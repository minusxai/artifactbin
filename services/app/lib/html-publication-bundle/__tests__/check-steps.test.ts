import {expect,it} from 'vitest';

// The steps file as check runs it: stepsBody's function body, driven by runSteps on a stub page.
async function run(source:string){
 const {stepsBody}=await import('../../../skills/artifactbin/scripts/check.mjs');
 const {runSteps}=await import('../../../skills/artifactbin/scripts/toolbox-check-steps.mjs');
 const events:string[]=[];
 const page={locator:()=>({evaluate:async()=>{}}),title:async()=>'Signups',log:(value:string)=>events.push(value)};
 const task=new (Object.getPrototypeOf(async function(){}).constructor)('page','step',stepsBody(source));
 const evidence:Record<string,unknown>={};
 const error=await runSteps(page,false,task,async()=>{},evidence).then(()=>undefined,(failure:Error)=>failure.message);
 return {error,events,evidence};
}
const pause='await new Promise(resolve=>setTimeout(resolve,5));';

it('runs an export-default array of step calls in order, each given {page}',async()=>{
 // The steps file an agent wrote on production (2026-11-07): it ended the hosted session.
 const {error,events,evidence}=await run(`export default [
  step('logo above title', async ({ page }) => { page.log('a start'); ${pause} page.log('a end'); }),
  step('picture after signups paragraph', async ({ page }) => { page.log('b ' + await page.title()); }),
 ];`);
 expect(error).toBeUndefined();
 expect(events).toEqual(['a start','a end','b Signups']);
 expect(evidence).toMatchObject({steps:{ran:true,passed:true},verified:['logo above title','picture after signups paragraph']});
});

it('stops an array at its first failing step and names it',async()=>{
 const {error,events,evidence}=await run(`export default [
  step('first', async () => { page.log('first'); }),
  step('second', async ({page}) => { throw new Error('figure missing'); }),
  step('third', async () => { page.log('third'); }),
 ];`);
 expect(error).toMatch(/^figure missing.*"first" \d+ ms, "second" unfinished/);
 expect(events).toEqual(['first']);expect(evidence).toMatchObject({steps:{passed:false},failedStep:'second',verified:['first']});
});

it('gives a step page, {page} or nothing, and runs a step the body never awaited after it, in call order',async()=>{
 const {error,events,evidence}=await run(`await step('destructured', async ({page}) => page.log(await page.title()));
  await step('plain', async (p) => p.log('plain'));
  step('left un-awaited', async () => page.log('later'));
  await step('none', async () => page.log('none'));
  return {done: true};`);
 expect(error).toBeUndefined();
 expect(events).toEqual(['Signups','plain','none','later']);
 expect(evidence).toMatchObject({task:{done:true},verified:['destructured','plain','none','left un-awaited']});
});

it('keeps an export-default function taking page or {page}, and nested steps',async()=>{
 const {error,evidence}=await run(`export default async ({page}) => { await step('outer', async () => { await step('inner', async ({page}) => page.log('in')); }); return await page.title(); };`);
 expect(error).toBeUndefined();expect(evidence).toMatchObject({task:'Signups',verified:['inner','outer']});
});

it('names the supported forms for a steps file it cannot run, and a step without a function',async()=>{
 const bad=await run(`export default {logo: true};`);
 expect(bad.error).toMatch(/^Steps file: export default must be an async function taking page or \{page\}, or an array of step\('label', async \(\{page\}\) => …\) calls; got object/);
 const noFn=await run(`await step('logo above title');`);
 expect(noFn.error).toMatch(/^step\("logo above title", fn\): fn must be a function such as async \(\{page\}\) => …; got undefined/);
});
