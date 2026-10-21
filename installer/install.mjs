#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { mkdir, mkdtemp, writeFile, rename, rm, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DEFAULT_ORIGIN='https://app.artefactbin.dev';
const NAME='artifactbin-author';
const targets=[['.claude/skills',[]],['.agents/skills',['.agents','.codex']],['.pi/agent/skills',['.pi']],['.config/opencode/skills',['.config/opencode']]];
const exists=async path=>access(path).then(()=>true,()=>false);
export function normalizeOrigin(value) {
 const url=new URL(value);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash) throw Error('Use an HTTP(S) server origin without a path or credentials.');
 return url.origin;
}
/** Validate the entire bounded ustar archive before creating any destination files. */
export function readArchive(archive) {
 const bytes=gunzipSync(archive,{maxOutputLength:32*1024*1024}), files=new Map();
 let offset=0, ended=false;
 const text=(block,start,length)=>block.subarray(start,start+length).toString('utf8').split('\0')[0];
 while(offset+512<=bytes.length) {
  const block=bytes.subarray(offset,offset+512); offset+=512;
  if(block.every(byte=>byte===0)){ ended=true; break; }
  const recorded=parseInt(text(block,148,8).trim(),8); let sum=0;
  for(let i=0;i<512;i++) sum+=i>=148&&i<156?32:block[i];
  if(recorded!==sum) throw Error('Invalid archive checksum.');
  const name=text(block,0,100), prefix=text(block,345,155), type=text(block,156,1)||'0';
  const segments=name.split('/');
  if(prefix||segments[0]!=='pagegi-author'||segments.some(part=>part==='..'||part==='.')||name.includes('\\')||!['0','5'].includes(type)) throw Error('Unsupported skill archive entry.');
  const size=parseInt(text(block,124,12).trim(),8);
  if(!Number.isSafeInteger(size)||size<0||offset+size>bytes.length) throw Error('Invalid archive size.');
  const relative=segments.slice(1).join('/');
  if(type==='0') {
   if(!relative||relative.endsWith('/')||files.has(relative)) throw Error('Invalid or duplicate skill file.');
   files.set(relative,bytes.subarray(offset,offset+size));
  }
  offset+=Math.ceil(size/512)*512;
 }
 if(!ended||!files.has('SKILL.md')) throw Error('Archive is missing SKILL.md or its terminator.');
 return files;
}
/** @param {import('./contracts.ts').InstallOptions} options */
export async function installSkill({home,origin,archive}, fs={mkdir,mkdtemp,writeFile,rename,rm}) {
 origin=normalizeOrigin(origin); const files=readArchive(archive), installed=[];
 for(const [folder,markers] of targets) {
  if(markers.length&&!(await Promise.all(markers.map(marker=>exists(join(home,marker))))).some(Boolean)) continue;
  const parent=join(home,folder), destination=join(parent,NAME);
  await fs.mkdir(parent,{recursive:true}); const stage=await fs.mkdtemp(join(parent,'.artifactbin-install-'));
  let backed=false, replaced=false;
  try {
   const next=join(stage,'next'); await fs.mkdir(next);
   for(const [name,body] of files) {
    const path=join(next,name); await fs.mkdir(dirname(path),{recursive:true});
    // The server archive consists of text authoring assets. Custom servers must
    // also be the default for bundled helpers, with no environment setup needed.
    const content=body.toString('utf8').replaceAll(DEFAULT_ORIGIN,origin);
    await fs.writeFile(path,content,{mode:name.endsWith('.mjs')?0o755:0o644});
   }
   if(await exists(destination)){ await fs.rename(destination,join(stage,'previous')); backed=true; }
   await fs.rename(next,destination); replaced=true;
   installed.push({folder:parent,name:NAME});
  } catch(error) {
   if(backed&&!replaced) {
    try { await fs.rename(join(stage,'previous'),destination); backed=false; }
    catch { throw Error(`Installation failed; previous skill retained at ${join(stage,'previous')}`,{cause:error}); }
   }
   throw error;
  } finally {
   if(!backed||replaced) await fs.rm(stage,{recursive:true,force:true});
  }
 }
 return installed;
}
async function main(args) {
 if(args.includes('--help')) { console.log('Usage: npx artefactbin-skill [--origin https://your-server.example]\nInstalls only the Artifactbin author skill. Restart your coding agent afterward.'); return; }
 let origin=process.env.AF_SERVER||DEFAULT_ORIGIN;
 if(args.length) { if(args.length!==2||args[0]!=='--origin') throw Error('Unknown arguments. Use --help.'); origin=args[1]; }
 origin=normalizeOrigin(origin);
 const response=await fetch(`${origin}/skills/pagegi-author.tgz`,{signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!response.ok) throw Error(`Skill download failed (${response.status}).`);
 const declared=Number(response.headers.get('content-length')); if(declared>8*1024*1024) throw Error('Skill archive is too large.');
 const chunks=[]; let size=0;
 for await(const chunk of response.body) { size+=chunk.length; if(size>8*1024*1024) throw Error('Skill archive is too large.'); chunks.push(chunk); }
 const installed=await installSkill({home:homedir(),origin,archive:Buffer.concat(chunks)});
 for(const result of installed) console.log(`Installed ${result.name} in ${result.folder}`);
 console.log('Restart your coding agent to load the skill.');
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
