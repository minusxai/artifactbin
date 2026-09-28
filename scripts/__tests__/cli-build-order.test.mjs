import {beforeEach,describe,it,expect,vi} from 'vitest';
const stage=vi.hoisted(()=>({events:[],failHost:false}));
vi.mock('esbuild',()=>({build:async()=>{stage.events.push('bundle');}}));
vi.mock('node:child_process',()=>({execFileSync:(_file,args)=>{
 if(args.includes('scripts/build-host.mjs')){stage.events.push('host');if(stage.failHost)throw new Error('host failed');}
}}));
vi.mock('node:fs/promises',()=>({
 chmod:async()=>{},mkdir:async()=>{},writeFile:async()=>{},rm:async()=>{},
 readFile:async()=>JSON.stringify({files:{},man:'manual'}),
}));
beforeEach(()=>{vi.resetModules();stage.events=[];stage.failHost=false;});
describe('CLI generation completion',()=>{
 it('finishes generated host inputs before emitting the CLI entry used by stale detection',async()=>{
  await import('../../services/cli/scripts/build.mjs');
  expect(stage.events).toEqual(['host','bundle']);
 });
 it('does not publish a fresh CLI entry if host generation fails',async()=>{
  stage.failHost=true;
  await expect(import('../../services/cli/scripts/build.mjs')).rejects.toThrow('host failed');
  expect(stage.events).toEqual(['host']);
 });
});
