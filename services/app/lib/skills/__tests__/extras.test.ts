/**
 * DEPLOYMENT EXTRAS (SKILLS__EXTRA_DIR, ../extras): what a directory may add to the served skill, that it lands under
 * `extras/` only, that the release identity covers it, that an origin without the setting serves what it did, and
 * that the served archive follows the directory without a restart.
 */
import {describe,expect,it,onTestFinished,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {rename,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {GET as archive} from '@/app/skills/artifactbin.zip/route';
import {GET as latest} from '@/app/skills/artifactbin/latest.json/route';
import {GET as llms} from '@/app/llms.txt/route';
import {overrideConfig} from '@/lib/platform/config';
import {EXTRA_ENTRY_POINTS,EXTRA_FILE_MAX_BYTES,EXTRAS_MAX_BYTES,EXTRAS_MAX_FILES,readSkillExtras,skillExtras} from '../extras';
import {skillPackageFiles,skillRelease} from '../package';
import {SKILL_MAIN_MAX_BYTES,skillTree} from '..';
import {tempDirSync} from '@artifactbin/test-support/temp-dir';
const require=createRequire(import.meta.url);
// Loaded once, so a request below starts in the same turn its caller does, never a module load later.
const {decodeRelease}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update-archive.mjs'));
function directory(files:Record<string,string|Buffer>):string{
 const root=tempDirSync('skill-extras-',onTestFinished);
 for(const [name,content] of Object.entries(files))writeFileSync(path.join(root,name),content);
 return root;
}
const GUIDE='# Warehouse queries\n\nRead when the user asks about the warehouse.\n\nRun `node extras/warehouse.mjs`.\n';
const SCRIPT='import {makeClient,selectedServer} from \'../scripts/toolbox-client.mjs\';\nconsole.log(typeof makeClient,selectedServer());\n';
const valid=()=>directory({'warehouse.md':GUIDE,'warehouse.mjs':SCRIPT,'tables.json':'{"tables":[]}'});
async function served(origin:string){
 const manifest=await (await latest(new Request(origin+'/skills/artifactbin/latest.json'))).json();
 const bytes=Buffer.from(await (await archive(new Request(origin+'/skills/artifactbin.zip'))).arrayBuffer());
 return {manifest,bytes,files:decodeRelease(bytes,manifest) as Record<string,string>};
}

describe('reading the extras directory',()=>{
 it('ships each file under extras/ with a generated index of the guides',()=>{
  const {files}=readSkillExtras(valid());
  expect(Object.keys(files).sort()).toEqual(['extras/README.md','extras/tables.json','extras/warehouse.md','extras/warehouse.mjs']);
  expect(files['extras/warehouse.mjs']).toBe(SCRIPT);
  expect(files['extras/README.md']).toContain('- [Warehouse queries](warehouse.md): Read when the user asks about the warehouse.');
  expect(files['extras/README.md']).toContain('Scripts and data: `tables.json`, `warehouse.mjs`.');
 });
 it.each([
  ['a missing directory',()=>path.join(tmpdir(),'no-such-extras-dir-'+process.pid),'cannot be read'],
  ['an empty directory',()=>directory({}),'is empty'],
  ['a hidden file',()=>directory({'.env':'SECRET=1','a.md':'# A\n'}),'.env: hidden'],
  ['another type',()=>directory({'run.sh':'echo'}),'run.sh: names'],
  ['an upper-case name',()=>directory({'Guide.md':'# G\n'}),'Guide.md: names'],
  ['the reserved index name',()=>directory({'readme.md':'# Mine\n'}),'readme.md: names'],
  ['a guide without a heading',()=>directory({'a.md':'no heading'}),'a.md: a guide needs'],
  ['invalid JSON',()=>directory({'a.json':'{'}),'a.json: not valid JSON'],
  ['bytes that are not UTF-8',()=>directory({'a.mjs':Buffer.from([0xff,0xfe])}),'a.mjs: not UTF-8'],
  ['a file over its limit',()=>directory({'a.mjs':'x'.repeat(EXTRA_FILE_MAX_BYTES+1)}),'more than 65536'],
  ['files over the total',()=>directory(Object.fromEntries(Array.from({length:5},(_,i)=>[`f${i}.mjs`,'x'.repeat(EXTRAS_MAX_BYTES/4)]))),'together'],
  ['too many files',()=>directory(Object.fromEntries(Array.from({length:EXTRAS_MAX_FILES+1},(_,i)=>[`f${i}.mjs`,'']))),'more than 32'],
 ])('refuses %s, naming the setting',(_,dir,problem)=>{
  expect(()=>readSkillExtras(dir())).toThrow(/SKILLS__EXTRA_DIR .*/);
  expect(()=>readSkillExtras(dir())).toThrow(problem);
 });
 it('refuses a subdirectory and a symlink, so nothing outside the directory is shipped',()=>{
  const outside=directory({'secret.md':'# Secret\n'});
  const linked=directory({'a.md':'# A\n'});symlinkSync(path.join(outside,'secret.md'),path.join(linked,'escape.md'));
  expect(()=>readSkillExtras(linked)).toThrow('escape.md: symlinks are not shipped');
  const nested=directory({'a.md':'# A\n'});mkdirSync(path.join(nested,'lib'));writeFileSync(path.join(nested,'lib','b.mjs'),'');
  expect(()=>readSkillExtras(nested)).toThrow('lib: only files are shipped');
 });
 it('refuses a member outside extras/, so an extra never replaces a product file',()=>{
  const files={'scripts/publish.mjs':'replaced'};
  expect(()=>skillPackageFiles(skillTree(),'https://x.example',{},{dir:'/x',files,intro:null})).toThrow('Unsupported skill extra: scripts/publish.mjs');
 });
 it('keeps the extras while the directory is unchanged, follows a change, and refuses an invalid value at its first read',()=>{
  overrideConfig({},{SKILLS__EXTRA_DIR:undefined});expect(skillExtras()).toBeNull();
  const dir=valid();overrideConfig({},{SKILLS__EXTRA_DIR:dir});
  const first=skillExtras();
  expect(skillExtras()).toBe(first);
  writeFileSync(path.join(dir,'later.md'),'# Later\n');
  expect(skillExtras()!.files['extras/later.md']).toBe('# Later\n');
  overrideConfig({},{SKILLS__EXTRA_DIR:directory({'.hidden':''})});
  expect(()=>skillExtras()).toThrow('SKILLS__EXTRA_DIR');
 });
});

describe('the served archive',()=>{
 it('carries the extras and the SKILL.md pointer only on an origin with the setting, and its version covers them',async()=>{
  overrideConfig({},{SKILLS__EXTRA_DIR:undefined});
  const plain=await served('https://extras.example');
  expect(Object.keys(plain.files).filter(name=>name.startsWith('extras/'))).toEqual([]);
  expect(plain.files['SKILL.md']).not.toContain('extras/');
  overrideConfig({},{SKILLS__EXTRA_DIR:valid()});
  const extended=await served('https://extras.example');
  expect(extended.files['extras/warehouse.md']).toBe(GUIDE);
  expect(extended.files['SKILL.md']).toContain('This server adds guides and scripts of its own: `extras/README.md` lists them.');
  expect(extended.manifest.version).not.toBe(plain.manifest.version);
  // Every product file is the plain archive's, byte for byte: extras only add.
  const product=(files:Record<string,string>)=>Object.fromEntries(Object.entries(files).filter(([name])=>!name.startsWith('extras/')&&name!=='SKILL.md'&&name!=='release.json'));
  expect(product(extended.files)).toEqual(product(plain.files));
  expect(extended.files['SKILL.md'].replace(' This server adds guides and scripts of its own: `extras/README.md` lists them.','')).toBe(plain.files['SKILL.md']);
  expect(Buffer.byteLength(extended.files['SKILL.md'])).toBeLessThanOrEqual(SKILL_MAIN_MAX_BYTES);
  overrideConfig({},{SKILLS__EXTRA_DIR:undefined});
  expect((await served('https://extras.example')).bytes.equals(plain.bytes)).toBe(true);
 });
 it('changes the release version when only an extra changes',()=>{
  const one=readSkillExtras(directory({'a.md':'# A\n'})).files,two=readSkillExtras(directory({'a.md':'# A\nchanged\n'})).files;
  expect(skillRelease({'SKILL.md':'s',...one},'https://x.example').manifest.version).not.toBe(skillRelease({'SKILL.md':'s',...two},'https://x.example').manifest.version);
 });
});

describe('following the directory without a restart',()=>{
 const ORIGIN='https://follow.example';
 const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
 /** One request for the archive (optionally revalidating) and its decoded extras, checked against its own ETag. */
 async function fetched(tag?:string,sha256?:string){
  const response=await archive(new Request(ORIGIN+'/skills/artifactbin.zip'+(sha256?`?sha256=${sha256}`:''),{headers:tag?{'if-none-match':tag}:{}}));
  const etag=response.headers.get('etag')!,bytes=Buffer.from(await response.arrayBuffer());
  if(response.status!==200)return {status:response.status,etag,bytes,extras:null,cache:response.headers.get('cache-control')};
  const digest=createHash('sha256').update(bytes).digest();
  expect(etag).toBe(`"${digest.toString('base64url').slice(0,22)}"`);
  // Decoded once per distinct archive. Members are stored uncompressed: the release identity is read from the
  // archive, then decodeRelease checks it against the bytes.
  let extras=decoded.get(digest.toString('hex'));
  if(!extras){
   const version=/"origin":"[^"]+","version":"([a-f0-9]{64})"/.exec(bytes.toString('utf8'))![1];
   const files=decodeRelease(bytes,{sha256:digest.toString('hex'),origin:ORIGIN,version}) as Record<string,string>;
   extras=Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('extras/')&&name!=='extras/README.md'));
   decoded.set(digest.toString('hex'),extras);
  }
  return {status:response.status,etag,bytes,extras,cache:response.headers.get('cache-control')};
 }
 const decoded=new Map<string,Record<string,string>>();
 const manifest=async()=>(await latest(new Request(ORIGIN+'/skills/artifactbin/latest.json'))).json();
 it('serves an edited, added and removed file at the next request with a new ETag, and keeps the ETag while nothing changed',async()=>{
  const dir=directory({'warehouse.md':GUIDE,'warehouse.mjs':SCRIPT});overrideConfig({},{SKILLS__EXTRA_DIR:dir});
  const first=await fetched();
  expect(first.extras).toEqual({'extras/warehouse.md':GUIDE,'extras/warehouse.mjs':SCRIPT});
  const again=await fetched();
  expect(again.etag).toBe(first.etag);expect(again.bytes.equals(first.bytes)).toBe(true);
  expect((await fetched(first.etag)).status).toBe(304);
  expect((await manifest()).sha256).toBe(sha(first.bytes));

  const EDITED=GUIDE.replace('warehouse.mjs','warehouse.mjs --all');
  writeFileSync(path.join(dir,'warehouse.md'),EDITED);
  const edited=await fetched(first.etag);
  expect(edited.status).toBe(200);expect(edited.etag).not.toBe(first.etag);
  expect(edited.extras).toEqual({'extras/warehouse.md':EDITED,'extras/warehouse.mjs':SCRIPT});
  expect((await manifest()).sha256).toBe(sha(edited.bytes));

  // Rewritten at once with the same length: within one timestamp tick only the content tells it apart.
  const SAME_LENGTH=EDITED.replace('--all','--any');
  writeFileSync(path.join(dir,'warehouse.md'),SAME_LENGTH);
  const rewritten=await fetched();
  expect(rewritten.extras!['extras/warehouse.md']).toBe(SAME_LENGTH);expect(rewritten.etag).not.toBe(edited.etag);

  writeFileSync(path.join(dir,'notes.json'),'{"note":1}');
  const added=await fetched();
  expect(added.extras!['extras/notes.json']).toBe('{"note":1}');expect(added.etag).not.toBe(rewritten.etag);
  expect((await manifest()).sha256).toBe(sha(added.bytes));

  rmSync(path.join(dir,'notes.json'));
  const removed=await fetched();
  expect(Object.keys(removed.extras!).sort()).toEqual(['extras/warehouse.md','extras/warehouse.mjs']);
  // The same files are the same archive: the ETag changes exactly when the bytes do.
  expect(removed.etag).toBe(rewritten.etag);expect(removed.bytes.equals(rewritten.bytes)).toBe(true);
  expect((await manifest()).sha256).toBe(sha(removed.bytes));
 });
 it('sees a same-length rewrite made at once, within one timestamp tick, and serves it to requests that arrive together',async()=>{
  const dir=directory({'a.mjs':'export const n=00;\n'});overrideConfig({},{SKILLS__EXTRA_DIR:dir});
  for(let n=1;n<50;n++){
   const source=`export const n=${String(n).padStart(2,'0')};\n`;
   writeFileSync(path.join(dir,'a.mjs'),source);
   expect(skillExtras()!.files['extras/a.mjs']).toBe(source);
  }
  const before=await fetched();
  writeFileSync(path.join(dir,'a.mjs'),'export const n=50;\n');
  // Requests that arrive together, while the changed archive builds, share that one build.
  const together=await Promise.all(Array.from({length:6},()=>fetched()));
  for(const one of together){
   expect(one.etag).not.toBe(before.etag);expect(one.etag).toBe(together[0]!.etag);
   expect(one.bytes.equals(together[0]!.bytes)).toBe(true);expect(one.extras).toEqual({'extras/a.mjs':'export const n=50;\n'});
  }
 });
 it('keeps serving the last valid archive through an invalid state, logs each problem once, and recovers',async()=>{
  const dir=directory({'warehouse.md':GUIDE});overrideConfig({},{SKILLS__EXTRA_DIR:dir});
  const good=await fetched();
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});onTestFinished(()=>warn.mockRestore());
  const keeps=async()=>{for(let i=0;i<3;i++){const served=await fetched();expect(served.etag).toBe(good.etag);expect(served.bytes.equals(good.bytes)).toBe(true);}};

  writeFileSync(path.join(dir,'Upper.md'),'# Upper\n');
  await keeps();
  expect(warn.mock.calls.map(call=>String(call[0]))).toEqual([expect.stringMatching(/^\[skills\] SKILLS__EXTRA_DIR ".*": Upper\.md: names are lowercase .*; still serving the extras last read, until it is valid again\.$/)]);
  expect(skillExtras()!.files['extras/warehouse.md']).toBe(GUIDE);
  rmSync(path.join(dir,'Upper.md'));

  // Every boot-time limit holds on a reread: per-file and total size, the file count, links and subdirectories.
  const states:[string,()=>void,()=>void][]=[
   ['more than 65536',()=>writeFileSync(path.join(dir,'big.mjs'),'x'.repeat(EXTRA_FILE_MAX_BYTES+1)),()=>rmSync(path.join(dir,'big.mjs'))],
   ['together',()=>{for(let i=0;i<4;i++)writeFileSync(path.join(dir,`f${i}.mjs`),'x'.repeat(EXTRA_FILE_MAX_BYTES));},()=>{for(let i=0;i<4;i++)rmSync(path.join(dir,`f${i}.mjs`));}],
   ['more than 32',()=>{for(let i=0;i<EXTRAS_MAX_FILES;i++)writeFileSync(path.join(dir,`n${i}.mjs`),'');},()=>{for(let i=0;i<EXTRAS_MAX_FILES;i++)rmSync(path.join(dir,`n${i}.mjs`));}],
   ['symlinks are not shipped',()=>symlinkSync(path.join(directory({'secret.md':'# Secret\n'}),'secret.md'),path.join(dir,'escape.md')),()=>rmSync(path.join(dir,'escape.md'))],
   ['only files are shipped',()=>mkdirSync(path.join(dir,'lib')),()=>rmSync(path.join(dir,'lib'),{recursive:true})],
   ['hidden files are not shipped',()=>writeFileSync(path.join(dir,'.warehouse.md.swp'),''),()=>rmSync(path.join(dir,'.warehouse.md.swp'))],
  ];
  for(const [problem,enter,leave] of states){
   enter();warn.mockClear();
   await keeps();
   expect(warn).toHaveBeenCalledTimes(1);expect(String(warn.mock.calls[0]![0])).toContain(problem);
   leave();
  }
  warn.mockClear();
  writeFileSync(path.join(dir,'later.md'),'# Later\n');
  const recovered=await fetched();
  expect(recovered.extras).toEqual({'extras/warehouse.md':GUIDE,'extras/later.md':'# Later\n'});
  expect(warn.mock.calls.map(call=>String(call[0]))).toEqual([expect.stringMatching(/^\[skills\] SKILLS__EXTRA_DIR ".*" is valid again: serving its files\.$/)]);
  await fetched();expect(warn).toHaveBeenCalledTimes(1);
 });
 it('gives requests during a change one whole archive each, never a mix of one read\'s files and another\'s',async()=>{
  const v=(name:string,n:number)=>`# ${name} ${n}\n\n${'line\n'.repeat(400*n)}`;
  const dir=directory({'a.md':v('A',0),'b.md':v('B',0)});overrideConfig({},{SKILLS__EXTRA_DIR:dir});
  const staging=tempDirSync('skill-extras-staging-',onTestFinished);
  const place=async(name:string,content:string)=>{const file=path.join(staging,name);await writeFile(file,content);await rename(file,path.join(dir,name));};
  const states=[[0,0],[1,0],[1,1]].map(([a,b])=>({'extras/a.md':v('A',a!),'extras/b.md':v('B',b!)}));
  const requests:Promise<Awaited<ReturnType<typeof fetched>>>[]=[],manifests:Promise<{sha256:string}>[]=[];
  // Requests start while the earlier ones still build and while renames run on the file system's own threads.
  const writes=(async()=>{for(const [name,n] of [['a.md',1],['b.md',1]] as const)await place(name,v(name[0]!.toUpperCase(),n));})();
  for(let i=0;i<16;i++){requests.push(fetched());if(i%4===0)manifests.push(manifest());await new Promise(resolve=>setImmediate(resolve));}
  await writes;
  requests.push(fetched());manifests.push(manifest());
  const served=await Promise.all(requests);
  const byTag=new Map<string,Buffer>();
  for(const one of served){
   expect(states).toContainEqual(one.extras);
   const seen=byTag.get(one.etag);if(seen)expect(one.bytes.equals(seen)).toBe(true);else byTag.set(one.etag,one.bytes);
  }
  expect(served[0]!.extras).toEqual(states[0]);expect(served.at(-1)!.extras).toEqual(states.at(-1));
  // Every manifest names one whole state, and its archive is still fetchable by its hash now the directory moved on.
  for(const one of await Promise.all(manifests)){
   const held=await fetched(undefined,one.sha256);
   expect(held.status).toBe(200);expect(sha(held.bytes)).toBe(one.sha256);expect(states).toContainEqual(held.extras);
  }
 });
 it('keeps the archive a manifest named fetchable by its hash after the directory moves on, and only that',async()=>{
  const dir=directory({'warehouse.md':GUIDE});overrideConfig({},{SKILLS__EXTRA_DIR:dir});
  const named=await manifest();
  // An updater reads latest.json, then fetches the archive: the directory changes in between.
  writeFileSync(path.join(dir,'warehouse.md'),GUIDE+'\nMore.\n');
  const current=await fetched();
  expect(sha(current.bytes)).not.toBe(named.sha256);
  const held=await fetched(undefined,named.sha256);
  expect(held.status).toBe(200);expect(sha(held.bytes)).toBe(named.sha256);
  expect(held.extras).toEqual({'extras/warehouse.md':GUIDE});expect(held.cache).toBe('public, max-age=31536000, immutable');
  expect((await fetched(held.etag,named.sha256)).status).toBe(304);
  // The current archive answers its own hash even before this process names it (after a restart, or when another
  // process answered latest.json); any other hash is not held.
  const now=await fetched(undefined,sha(current.bytes));
  expect(now.status).toBe(200);expect(now.bytes.equals(current.bytes)).toBe(true);
  for(const other of ['0'.repeat(64),'not-a-hash']){
   const missing=await fetched(undefined,other);
   expect(missing.status).toBe(404);expect(missing.cache).toBe('no-store');
  }
 });
});

describe('the served guide (/llms.txt)',()=>{
 const INTRO='# This server\n\nRead when you first reach this address.\n\nIt adds a warehouse; publishing pages: see below.\n';
 const guide=async()=>(await llms(new Request('https://x.example/llms.txt'))).text();
 it('opens with the deployment\'s intro.md, then the product guide unchanged; the intro also ships as an extra',async()=>{
  overrideConfig({},{SKILLS__EXTRA_DIR:undefined});
  const plain=await guide();
  overrideConfig({},{SKILLS__EXTRA_DIR:directory({'intro.md':INTRO,'warehouse.md':GUIDE})});
  expect(await guide()).toBe(`${INTRO.trim()}\n\n${plain}`);
  expect(skillExtras()!.files['extras/intro.md']).toBe(INTRO);
  expect(skillExtras()!.files['extras/README.md']).toContain('- [This server](intro.md): Read when you first reach this address.');
  // It follows an edit without a restart, like the archive.
  const EDITED=INTRO.replace('a warehouse','a warehouse and a queue');
  writeFileSync(path.join(skillExtras()!.dir,'intro.md'),EDITED);
  expect(await guide()).toBe(`${EDITED.trim()}\n\n${plain}`);
 });
 it('is the product guide alone without an intro.md or without extras',async()=>{
  overrideConfig({},{SKILLS__EXTRA_DIR:undefined});
  const plain=await guide();
  overrideConfig({},{SKILLS__EXTRA_DIR:valid()});
  expect(await guide()).toBe(plain);
  overrideConfig({},{SKILLS__EXTRA_DIR:undefined});
 });
});

describe('what an extra may import',()=>{
 it('keeps every entry point and name the extras documentation promises',async()=>{
  for(const [file,names] of Object.entries(EXTRA_ENTRY_POINTS)){
   const module=await import(require.resolve(`../../../skills/artifactbin/${file}`));
   for(const name of names)expect(module[name],`${file} ${name}`).toBeDefined();
  }
 });
});
