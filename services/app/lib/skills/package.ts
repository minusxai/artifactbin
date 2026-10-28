/** Public HTTP skill folder. References are shared with CLI teaching;
 * templates select HTTP procedures while the CLI compiler selects CLI procedures.
 * Assets are explicit: request input never selects a path or ZIP member. */
import {loadSkillAssets,skillAssetName,type SkillPackageAssets} from './assets';
import {isShippedSkillTopic} from './public-surface';
import {renderTree,skillFileWithFrontmatter} from './serve';
import type {SkillTree} from './tree';
export function skillPackageFiles(tree:SkillTree,base:string,assets:SkillPackageAssets=loadSkillAssets()):Record<string,string>{
 for(const name of Object.keys(assets))if(!skillAssetName(name))throw Error(`Unsupported skill asset: ${name}`);
 return {...assets,...Object.fromEntries(renderTree(tree,base,'http',true).filter(({file})=>!file.ref||isShippedSkillTopic(file.file.replace(/\.md$/,''))).map(({file,text})=>[file.path.replace(/^artifactbin\//,''),skillFileWithFrontmatter(file,text)]))};
}
/** Minimal stored ZIP: standard UTF-8 members, deterministic timestamps and CRC32.
 * Text members need no filesystem traversal or compression. No binary members: fonts load from the platform (D16). */
export type SkillArchiveFiles=Readonly<Record<string,string>>;
/** Bundles the platform now serves instead (D20): the preview fetches the runtime and libraries from the selected server. */
const RETIRED_MEMBERS=new Set(['scripts/preview-runtime.mjs','scripts/preview-libraries.mjs']);
export function skillZip(files:SkillArchiveFiles):Uint8Array<ArrayBuffer>{
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [relative,content] of Object.entries(files).sort(([a],[b])=>a.localeCompare(b))){
  if(typeof content!=='string'||RETIRED_MEMBERS.has(relative)||!(/^(?:SKILL\.md|references\/[a-z0-9-]+\.md)$/.test(relative)||skillAssetName(relative)))throw new Error(`Unsupported skill member: ${relative}`);
  const name=Buffer.from(`artifactbin/${relative}`),data=Buffer.from(content);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(0x21,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
  local.push(head,name,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=head.length+name.length+data.length;
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
 return new Uint8Array(Buffer.concat([...local,index,end]));
}
