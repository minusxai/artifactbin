/** One installable folder projection, shared by CLI teaching and the public ZIP.
 * Assets are explicit: request input never selects a path or ZIP member. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {renderTree,skillFileWithFrontmatter} from './serve';
import type {SkillTree} from './tree';
export const SKILL_SCRIPT_FILES=['scripts/credentials.mjs'] as const;
export function skillPackageFiles(tree:SkillTree,base:string,root=path.resolve(process.cwd(),'skills/artifactbin')):Record<string,string>{
 const files=Object.fromEntries(renderTree(tree,base).map(({file,text})=>[file.path.replace(/^artifactbin\//,''),skillFileWithFrontmatter(file,text)]));
 for(const name of SKILL_SCRIPT_FILES)files[name]=readFileSync(path.join(root,name),'utf8');
 return files;
}
/** Minimal stored ZIP: standard UTF-8 members, deterministic timestamps and CRC32.
 * The skill is small text; compression and filesystem traversal are unnecessary. */
export function skillZip(files:Record<string,string>):Uint8Array<ArrayBuffer>{
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [relative,text] of Object.entries(files).sort(([a],[b])=>a.localeCompare(b))){
  if(!/^(?:SKILL\.md|references\/[a-z0-9-]+\.md|scripts\/credentials\.mjs)$/.test(relative))throw new Error(`Unsupported skill member: ${relative}`);
  const name=Buffer.from(`artifactbin/${relative}`),data=Buffer.from(text);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(0x21,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
  local.push(head,name,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=head.length+name.length+data.length;
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
 return new Uint8Array(Buffer.concat([...local,index,end]));
}
