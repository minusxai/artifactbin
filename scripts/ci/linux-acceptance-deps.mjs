/** Cache only downloaded deb archives; Playwright still owns signed metadata, package selection and dpkg. */
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function runCommand(command,args){return new Promise((done,reject)=>{const child=spawn(command,args,{stdio:'inherit'});child.on('error',reject);child.on('exit',(code,signal)=>code===0?done():reject(new Error('Dependency command failed: '+command+' ('+(code??signal)+')')));});}
async function debArchives(directory){const files=[];for(const name of await readdir(directory)){if(!name.endsWith('.deb'))continue;const path=join(directory,name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('APT archives must be regular files');files.push(path);}return files;}
export async function installLinuxAcceptanceDependencies({cacheDirectory,playwrightCli},{run=runCommand,configDirectory='/etc/apt/apt.conf.d',uid=process.getuid?.(),gid=process.getgid?.(),readMetadata=readAptMetadata}={}){
 if(!Number.isSafeInteger(uid)||!Number.isSafeInteger(gid)||uid<0||gid<0)throw new Error('A Linux user identity is required');
 cacheDirectory=resolve(cacheDirectory);if(/[\x00-\x1f\x7f]/.test(cacheDirectory))throw new Error('Invalid APT cache path');
 await mkdir(cacheDirectory,{recursive:true,mode:0o755});const info=await lstat(cacheDirectory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('APT cache must be a real directory');await debArchives(cacheDirectory);
 // Refresh signed repository metadata before authorizing any restored completed archives.
 await run('sudo',['--','apt-get','update','-o','APT::Update::Error-Mode=any']);
 const checked=await validateRestoredAptArchives(cacheDirectory,readMetadata);
 console.log('APT archives: '+checked.verified+' SHA256-verified, '+checked.discarded+' discarded before provisioning');
 const temporary=await mkdtemp(join(tmpdir(),'afbin-apt-')),source=join(temporary,'archives.conf'),target=join(configDirectory,'99-afbin-archives-'+randomUUID());
 const quoted=cacheDirectory.replaceAll('\\','\\\\').replaceAll('"','\\"');
 await writeFile(source,'Dir::Cache::archives "'+quoted+'";\nAPT::Keep-Downloaded-Packages "true";\nBinary::apt-get::APT::Keep-Downloaded-Packages "true";\n',{mode:0o600});
 try{
  // A root-owned config survives Playwright's sudo boundary; APT sources, trust and lists are unchanged.
  await run('sudo',['--','install','-o','root','-g','root','-m','644',source,target]);
  await run(process.execPath,[playwrightCli,'install-deps','chromium']);
 }finally{
  try{await run('sudo',['--','rm','-f','--',target]);const archives=await debArchives(cacheDirectory);if(archives.length)await run('sudo',['--','chown','--no-dereference','--',uid+':'+gid,...archives]);}
  finally{await rm(temporary,{recursive:true,force:true});}
 }
}

const execute = promisify(execFile);
async function readAptMetadata(args) {
 return (await execute('apt-cache', args, {encoding:'utf8', maxBuffer:1024*1024})).stdout;
}
/** APT trusts same-size completed archives. Verify them ourselves against freshly signed package metadata. */
export async function validateRestoredAptArchives(directory, readMetadata) {
 let verified=0, discarded=0;
 for (const path of await debArchives(directory)) {
  const name=path.slice(path.lastIndexOf('/')+1);
  const match=/^([a-z0-9][a-z0-9+.-]*)_([^_]+)_([a-z0-9][a-z0-9-]*)\.deb$/.exec(name);
  let valid=false;
  if (match) {
   let version=''; try { version=decodeURIComponent(match[2]); } catch { /* unknown encoding is not trusted */ }
   if (/^[0-9][A-Za-z0-9.+:~\-]*$/.test(version)) {
    const output=await readMetadata(['show','--no-all-versions',match[1]+'='+version]).catch(()=> '');
    const bytes=await readFile(path), hash=createHash('sha256').update(bytes).digest('hex');
    valid=output.split(/\n\s*\n/).some(record=>{
     const fields=Object.fromEntries(record.split('\n').flatMap(line=>{const field=/^([^:\s]+):\s*(.*)$/.exec(line);return field?[[field[1],field[2]]]:[];}));
     return fields.Package===match[1] && fields.Version===version && fields.Architecture===match[3]
      && /^[0-9]+$/.test(fields.Size??'') && Number(fields.Size)===bytes.length
      && /^[a-f0-9]{64}$/i.test(fields.SHA256??'') && fields.SHA256.toLowerCase()===hash;
    });
   }
  }
  if (valid) verified++; else {await rm(path); discarded++;}
 }
 return {verified,discarded};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.platform!=='linux')throw new Error('Linux acceptance provisioning only');const [cacheDirectory,playwrightCli]=process.argv.slice(2);if(!cacheDirectory||!playwrightCli)throw new Error('Usage: linux-acceptance-deps.mjs <archive-cache> <playwright-cli>');await installLinuxAcceptanceDependencies({cacheDirectory,playwrightCli});}
