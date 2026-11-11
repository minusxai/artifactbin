/**
 * DEPLOYMENT EXTRAS (SKILLS__EXTRA_DIR, ../extras): what a directory may add to the served skill, that it lands under
 * `extras/` only, that the release identity covers it, and that an origin without the setting serves what it did.
 */
import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {GET as archive} from '@/app/skills/artifactbin.zip/route';
import {GET as latest} from '@/app/skills/artifactbin/latest.json/route';
import {overrideConfig} from '@/lib/platform/config';
import {EXTRA_ENTRY_POINTS,EXTRA_FILE_MAX_BYTES,EXTRAS_MAX_BYTES,EXTRAS_MAX_FILES,readSkillExtras,skillExtras} from '../extras';
import {skillPackageFiles,skillRelease} from '../package';
import {SKILL_MAIN_MAX_BYTES,skillTree} from '..';
const require=createRequire(import.meta.url);
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function directory(files:Record<string,string|Buffer>):string{
 const root=mkdtempSync(path.join(tmpdir(),'skill-extras-'));roots.push(root);
 for(const [name,content] of Object.entries(files))writeFileSync(path.join(root,name),content);
 return root;
}
const GUIDE='# Warehouse queries\n\nRead when the user asks about the warehouse.\n\nRun `node extras/warehouse.mjs`.\n';
const SCRIPT='import {makeClient,selectedServer} from \'../scripts/toolbox-client.mjs\';\nconsole.log(typeof makeClient,selectedServer());\n';
const valid=()=>directory({'warehouse.md':GUIDE,'warehouse.mjs':SCRIPT,'tables.json':'{"tables":[]}'});
async function served(origin:string){
 const {decodeRelease}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update-archive.mjs'));
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
  expect(()=>skillPackageFiles(skillTree(),'https://x.example',{},{dir:'/x',files})).toThrow('Unsupported skill extra: scripts/publish.mjs');
 });
 it('reads the setting once and refuses an invalid value at its first read',()=>{
  overrideConfig({},{SKILLS__EXTRA_DIR:undefined});expect(skillExtras()).toBeNull();
  const dir=valid();overrideConfig({},{SKILLS__EXTRA_DIR:dir});
  const first=skillExtras();writeFileSync(path.join(dir,'later.md'),'# Later\n');
  expect(skillExtras()).toBe(first);
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

describe('what an extra may import',()=>{
 it('keeps every entry point and name the extras documentation promises',async()=>{
  for(const [file,names] of Object.entries(EXTRA_ENTRY_POINTS)){
   const module=await import(require.resolve(`../../../skills/artifactbin/${file}`));
   for(const name of names)expect(module[name],`${file} ${name}`).toBeDefined();
  }
 });
});
