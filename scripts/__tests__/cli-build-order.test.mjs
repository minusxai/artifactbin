import {beforeEach,describe,it,expect,vi} from 'vitest';
const stage=vi.hoisted(()=>({events:[],failHost:false,failDeclarations:false}));
vi.mock('esbuild',()=>({build:async()=>{stage.events.push('bundle');}}));
vi.mock('node:child_process',async()=>{
 const {EventEmitter}=await import('node:events');
 return {
  execFileSync:(_file,args)=>{
   if(args.includes('scripts/build-host.mjs')){stage.events.push('host');if(stage.failHost)throw new Error('host failed');}
  },
  // The declaration build runs beside the host build and finishes after it here: the order the bundle must wait out.
  spawn:(_file,args)=>{
   const child=new EventEmitter();
   if(args.includes('tsconfig.build.json'))setTimeout(()=>{stage.events.push('declarations');child.emit('exit',stage.failDeclarations?2:0,null);},5);
   else setImmediate(()=>child.emit('exit',0,null));
   return child;
  },
 };
});
vi.mock('node:fs/promises',()=>({
 chmod:async()=>{},mkdir:async()=>{},writeFile:async()=>{},rm:async()=>{},
 readFile:async()=>JSON.stringify({files:{},man:'manual'}),
}));
beforeEach(()=>{vi.resetModules();stage.events=[];stage.failHost=false;stage.failDeclarations=false;});
describe('CLI generation completion',()=>{
 it('finishes generated host inputs before emitting the CLI entry used by stale detection',async()=>{
  await import('../../services/cli/scripts/build.mjs');
  expect(stage.events).toEqual(['host','declarations','bundle']);
 });
 it('does not publish a fresh CLI entry if host generation fails',async()=>{
  stage.failHost=true;
  await expect(import('../../services/cli/scripts/build.mjs')).rejects.toThrow('host failed');
  expect(stage.events).toEqual(['host','declarations']);
 });
 it('does not publish a fresh CLI entry if its declarations fail',async()=>{
  stage.failDeclarations=true;
  await expect(import('../../services/cli/scripts/build.mjs')).rejects.toThrow(/tsconfig\.build\.json exited with 2/);
  expect(stage.events).toEqual(['host','declarations']);
 });
});
