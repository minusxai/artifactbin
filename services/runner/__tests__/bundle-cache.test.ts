import {expect,it} from 'vitest';
import {version} from 'esbuild';
import {bundleSource,COMPILER_VERSION,createBundleCache} from '../src/compiler';
function counted(){const calls:string[]=[];return {calls,compile:async(source:string)=>{calls.push(source);await new Promise(r=>setTimeout(r,5));if(source.includes('broken'))throw Error('syntax');return 'bundle:'+source;}};}
it('builds a source once per compiler version and shares concurrent misses',async()=>{
 const c=counted();const bundle=createBundleCache({compile:c.compile,version:'v1'});
 expect(await Promise.all(Array.from({length:8},()=>bundle('a')))).toEqual(Array(8).fill('bundle:a'));
 expect(await bundle('a')).toBe('bundle:a');expect(c.calls).toEqual(['a']);
 await bundle('b');expect(c.calls).toEqual(['a','b']);
 const store=new Map<string,string>();await createBundleCache({compile:c.compile,version:'v1',store})('a');
 const other=createBundleCache({compile:c.compile,version:'v2',store});await other('a');expect(c.calls).toEqual(['a','b','a','a']);
 await createBundleCache({compile:c.compile,version:'v2',store})('a');expect(c.calls).toHaveLength(4);
});
it('never keeps failures and evicts the least recently used bundle',async()=>{
 const c=counted();const bundle=createBundleCache({compile:c.compile,version:'v1',maxEntries:2});
 await expect(bundle('broken')).rejects.toThrow('syntax');await expect(bundle('broken')).rejects.toThrow('syntax');expect(c.calls).toEqual(['broken','broken']);
 c.calls.length=0;await bundle('a');await bundle('b');await bundle('a');await bundle('c');
 await bundle('a');expect(c.calls).toEqual(['a','b','c']);
 await bundle('b');expect(c.calls).toEqual(['a','b','c','b']);
 await expect(bundle('x'.repeat(256*1024+1))).rejects.toThrow('source_limit');
});
it('keys the shipped bundler on the esbuild version and still refuses imports',async()=>{
 expect(COMPILER_VERSION).toContain(version);
 const source='export default ()=>1';expect(await bundleSource(source)).toBe(await bundleSource(source));
 await expect(bundleSource('import fs from "node:fs";export default fs')).rejects.toThrow('import_not_allowed');
});
