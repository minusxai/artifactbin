import {it,expect} from 'vitest';
import {deflateRawSync} from 'node:zlib';
import {installedFiles} from '../fixtures/component-baseline/publication.mjs';
import {skillZip} from '../../services/app/lib/skills/index.ts';
const required={'scripts/toolbox-publication-bundle.mjs':'export {};','scripts/preview-html.mjs':'export {};','design-systems/almanac.css':':root{}'};
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// Standard ZIP local headers, raw DEFLATE, matching central directory and EOCD.
function zip(entries){const locals=[],central=[];let offset=0;for(const [relative,text] of entries){const name=Buffer.from('artifactbin/'+relative),data=Buffer.from(text),payload=deflateRawSync(data),crc=crc32(data),head=Buffer.alloc(30),index=Buffer.alloc(46);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(0x800,6);head.writeUInt16LE(8,8);head.writeUInt32LE(crc,14);head.writeUInt32LE(payload.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);index.writeUInt32LE(0x02014b50);index.writeUInt16LE(0x800,8);index.writeUInt16LE(8,10);index.writeUInt32LE(crc,16);index.writeUInt32LE(payload.length,20);index.writeUInt32LE(data.length,24);index.writeUInt16LE(name.length,28);index.writeUInt32LE(offset,42);locals.push(head,name,payload);central.push(index,name);offset+=30+name.length+payload.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}
it('installs actual producer members and standard raw-deflated UTF-8 members identically',()=>{
 const files={...required,'references/runtime.md':'Native ✓\n'.repeat(1000)};
 for(const archive of [skillZip(files),zip(Object.entries(files))])expect(Object.fromEntries([...installedFiles(archive)].map(([name,data])=>[name,data.toString()]))).toEqual(files);
});
it('rejects unsafe paths, duplicate members and missing required members',()=>{
 for(const name of ['../escape','scripts//file','scripts/./file','scripts/../file','/absolute','scripts/evil\\file'])expect(()=>installedFiles(zip([...Object.entries(required),[name,'bad']]))).toThrow(/Unsafe/);
 expect(()=>installedFiles(zip([...Object.entries(required),['scripts/preview-html.mjs','duplicate']]))).toThrow(/Duplicate/);
 expect(()=>installedFiles(zip([['SKILL.md','only']]))).toThrow(/missing/);
});
it('rejects truncated archives, directory disagreement, corrupt bytes and unsupported flags/methods',()=>{
 const archive=zip(Object.entries(required));
 for(const truncate of [1,20,archive.length-10])expect(()=>installedFiles(archive.subarray(0,truncate))).toThrow(/ZIP/);
 for(const [offset,value] of [[6,1],[8,99],[14,123],[18,0xffffffff],[22,0xffffffff]]){const broken=Buffer.from(archive);broken.writeUInt32LE(value,offset);expect(()=>installedFiles(broken)).toThrow(/ZIP/);}
 const broken=Buffer.from(archive),directory=broken.readUInt32LE(broken.length-6);broken.writeUInt32LE(99,directory+42);expect(()=>installedFiles(broken)).toThrow(/ZIP/);
});
it('bounds actual decompression even when declared size lies',()=>{
 const archive=zip([...Object.entries(required),['references/runtime.md','a'.repeat(1024*1024)]]);
 let offset=0;for(let index=0;index<3;index++)offset+=30+archive.readUInt16LE(offset+26)+archive.readUInt32LE(offset+18);
 archive.writeUInt32LE(1,offset+22);expect(()=>installedFiles(archive)).toThrow(/ZIP/);
});

it('caps member count before any installation',()=>{
 const entries=[...Object.entries(required),...Array.from({length:4000},(_,index)=>['references/file'+index+'.md',''])];
 expect(()=>installedFiles(zip(entries))).toThrow(/Unsupported skill ZIP member/);
});
