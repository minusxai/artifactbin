import {expect,test} from 'vitest';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {crc32,deflateRawSync} from 'node:zlib';
import {authorSkillTargets,installAuthorSkill} from '../src/author-skill';

/** A real zip: the first entry deflated, the rest stored. */
function zip(files:Record<string,string>):Buffer{
 const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0;
 Object.entries(files).forEach(([name,text],index)=>{
  const data=Buffer.from(text),packed=index===0?deflateRawSync(data):data,method=index===0?8:0,file=Buffer.from(name);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(crc32(data),14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);central.writeUInt32LE(crc32(data),16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(file.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,file,packed);centrals.push(central,file);offset+=30+file.length+packed.length;
 });
 const directory=Buffer.concat(centrals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(centrals.length/2,8);end.writeUInt16LE(centrals.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
const SKILL='---\nname: artifactbin\ndescription: author skill\n---\n## Core flows\n';
const good=()=>zip({'artifactbin/SKILL.md':SKILL,'artifactbin/scripts/comment.mjs':'export {};\n'});
const serving=(body:()=>Response)=>{const urls:string[]=[];return {urls,fetch:(async(url:string|URL)=>{urls.push(String(url));return body();}) as typeof fetch};};
const exists=(path:string)=>stat(path).then(()=>true,()=>false);

test('installs the server\'s author skill into every harness folder, replacing an older copy atomically',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-author-skill-'));
 try{
  const targets=authorSkillTargets(home);
  expect(targets).toEqual([join(home,'.claude/skills/artifactbin'),join(home,'.codex/skills/artifactbin'),join(home,'.pi/agent/skills/artifactbin'),join(home,'.config/opencode/skills/artifactbin')]);
  await mkdir(targets[0]!,{recursive:true});await writeFile(join(targets[0]!,'.afbin-skill.json'),'{}');await writeFile(join(targets[0]!,'SKILL.md'),'old CLI skill');
  const {fetch,urls}=serving(()=>new Response(new Uint8Array(good())));
  const first=await installAuthorSkill({server:'https://app.example.com',targets,fetch});
  expect(urls).toEqual(['https://app.example.com/skills/artifactbin.zip']);
  expect(first.targets.map(t=>t.status)).toEqual(['installed','installed','installed','installed']);
  for(const target of targets){
   expect(await readFile(join(target,'SKILL.md'),'utf8')).toBe(SKILL);
   expect(await readFile(join(target,'scripts/comment.mjs'),'utf8')).toBe('export {};\n');
  }
  expect(await exists(join(targets[0]!,'.afbin-skill.json')),'the old copy is replaced whole').toBe(false);
  expect(await readdir(join(home,'.claude/skills'))).toEqual(['artifactbin']);
  const again=await installAuthorSkill({server:'https://app.example.com',targets,fetch});
  expect(again.targets.map(t=>t.status)).toEqual(['current','current','current','current']);
  expect(again.sha256).toBe(first.sha256);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('a failed check leaves every folder as it was',async()=>{
 const home=await mkdtemp(join(tmpdir(),'af-author-skill-bad-'));
 try{
  const [target]=authorSkillTargets(home,['claude']);
  await mkdir(target!,{recursive:true});await writeFile(join(target!,'SKILL.md'),'kept');
  const bodies:Array<()=>Response>=[
   ()=>new Response('nope',{status:503}),
   ()=>new Response('not a zip at all'),
   ()=>new Response(new Uint8Array(zip({'artifactbin/README.md':'no skill'}))),
   ()=>new Response(new Uint8Array(zip({'SKILL.md':SKILL}))),
   ()=>new Response(new Uint8Array(zip({'artifactbin/SKILL.md':SKILL,'artifactbin/../escape.md':'x'}))),
   ()=>new Response(new Uint8Array(zip({'artifactbin/SKILL.md':'---\nname: something-else\n---\n'}))),
   ()=>new Response(new Uint8Array(65*1024*1024)),
  ];
  for(const body of bodies){
   await expect(installAuthorSkill({server:'https://app.example.com',targets:[target!],fetch:serving(body).fetch})).rejects.toThrow();
   expect(await readFile(join(target!,'SKILL.md'),'utf8')).toBe('kept');
   expect(await readdir(join(home,'.claude/skills'))).toEqual(['artifactbin']);
  }
 }finally{await rm(home,{recursive:true,force:true});}
});

test('downloads only over HTTPS, except from a local development origin',async()=>{
 const {fetch,urls}=serving(()=>new Response(new Uint8Array(good())));
 await expect(installAuthorSkill({server:'http://app.example.com',targets:[],fetch})).rejects.toThrow(/HTTPS/);
 expect(urls).toEqual([]);
 await installAuthorSkill({server:'http://app.lvh.me:3030',targets:[],fetch});
 expect(urls).toEqual(['http://app.lvh.me:3030/skills/artifactbin.zip']);
});
