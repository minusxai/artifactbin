/** Validate and unpack the served skill ZIP for the installed-skill gates. */
import {inflateRawSync} from 'node:zlib';

/** Validate the whole actual HTTP archive before installing selected members.
 * Production keeps stored ZIPs for installed updater compatibility; standard raw
 * DEFLATE is also understood here, with both declared and actual output bounded. */
export function installedFiles(archive){
  const limit=128*1024*1024,memberLimit=32*1024*1024;
  if(!(archive instanceof Uint8Array)||archive.byteLength>limit)throw Error('Expected a bounded skill ZIP archive');
  const bytes=Buffer.from(archive),files=new Map(),entries=[];let offset=0,total=0;
  while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
    const method=bytes.readUInt16LE(offset+8),flags=bytes.readUInt16LE(offset+6);
    if(files.size>=4000||![0,8].includes(method)||(flags&~0x800)!==0)throw Error('Unsupported skill ZIP member');
    const size=bytes.readUInt32LE(offset+18),plain=bytes.readUInt32LE(offset+22),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra,end=start+size;
    if(end>bytes.length||plain>memberLimit||total+plain>limit||(method===0&&size!==plain))throw Error('Truncated or oversized skill ZIP member');
    const name=bytes.subarray(offset+30,offset+30+length).toString('utf8');
    if(!/^artifactbin\/[A-Za-z0-9._/-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe skill ZIP member');
    const relative=name.slice('artifactbin/'.length);if(files.has(relative))throw Error('Duplicate skill ZIP member');
    const payload=bytes.subarray(start,end);let data;
    try{if(method===0)data=payload;else{const inflated=inflateRawSync(payload,{maxOutputLength:Math.max(1,plain),info:true});if(inflated.engine.bytesWritten!==size)throw Error('Trailing compressed bytes');data=inflated.buffer;}}catch(error){throw Error('Invalid compressed skill ZIP member',{cause:error});}
    if(data.length!==plain)throw Error('Invalid skill ZIP member size');
    let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    if(crc!==bytes.readUInt32LE(offset+14))throw Error('Corrupt skill ZIP member');
    entries.push({offset,name,size,plain,crc,method,flags});files.set(relative,data);total+=data.length;offset=end;
  }
  const central=offset;
  for(const entry of entries){
    if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid skill ZIP directory');
    const length=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),end=offset+46+length+extra+comment;
    if(end>bytes.length||bytes.readUInt16LE(offset+8)!==entry.flags||bytes.readUInt16LE(offset+10)!==entry.method||bytes.readUInt32LE(offset+16)!==entry.crc||bytes.readUInt32LE(offset+20)!==entry.size||bytes.readUInt32LE(offset+24)!==entry.plain||bytes.readUInt16LE(offset+34)!==0||bytes.readUInt32LE(offset+42)!==entry.offset||bytes.subarray(offset+46,offset+46+length).toString('utf8')!==entry.name)throw Error('Invalid skill ZIP directory entry');
    offset=end;
  }
  if(!files.size||offset+22>bytes.length||bytes.readUInt32LE(offset)!==0x06054b50||offset+22+bytes.readUInt16LE(offset+20)!==bytes.length||bytes.readUInt16LE(offset+4)!==0||bytes.readUInt16LE(offset+6)!==0||bytes.readUInt16LE(offset+8)!==entries.length||bytes.readUInt16LE(offset+10)!==entries.length||bytes.readUInt32LE(offset+12)!==offset-central||bytes.readUInt32LE(offset+16)!==central)throw Error('Invalid skill ZIP end');
  for(const name of ['scripts/toolbox-publication-bundle.mjs','scripts/preview-html.mjs','design-systems/almanac.css'])if(!files.has(name))throw Error('Installed skill archive is missing '+name);
  return files;
}
