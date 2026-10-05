/**
 * THE FILES AN OLD 0.3.x INSTALL DOWNLOADS FROM EVERY RELEASE.
 *
 * `node transition-assets.mjs build <outDir>` writes nine files beside the npm tarball on the GitHub
 * release `afbin-v<version>`; `node transition-assets.mjs verify <dir>` re-proves them before upload.
 *
 * The 0.3.21 self-updater (services/cli/src/update.ts at tag afbin-v0.3.21) fetches
 * `afbin-<platform>-<arch>.manifest.json`, then the binary and `afbin-skills.json` it names, and accepts
 * them only when:
 *  - the manifest is at most 64 KiB, its `version`/`protocol` are a semver and a positive integer,
 *    `platform`/`arch` equal the host, `binary.file` is `afbin-<platform>-<arch>`, `skills.file` is
 *    `afbin-skills.json`, and both sha256 values are lowercase 64-hex digests of the downloaded bytes
 *    (no `gzip` entry: the asset is served as is);
 *  - the skill bundle is at most 4 MiB of JSON whose `version`/`protocol` equal the manifest's, with
 *    `files['SKILL.md']` present, every value a string and every path relative, without `..`/`.`
 *    segments, empty segments or backslashes;
 *  - the downloaded file, run with `--version --json` in an EMPTY environment (15 s timeout), prints
 *    exactly `{"version":"<version>","protocol":<protocol>}` matching the manifest.
 * Every release names the CLI package version and CLI_PROTOCOL_VERSION; the asset is
 * `services/cli/transition/afbin`, whose AFBIN_VERSION/AFBIN_PROTOCOL pins must agree.
 *
 * The skill bundle ships unaddressed (`__AFBIN_SERVER__`): 0.3.21's installSkills runs the downloaded
 * files through teachingFilesFor with that same token, exactly as 0.4.x does with its own bundle.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmod,mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repository=resolve(cli,'../..');
const TARGETS=[['darwin','arm64'],['darwin','x64'],['linux','arm64'],['linux','x64']];
const SKILLS='afbin-skills.json';
const MANIFEST_LIMIT=65536,SKILLS_LIMIT=4194304;
const binaryName=(platform,arch)=>`afbin-${platform}-${arch}`;
const manifestName=(platform,arch)=>`${binaryName(platform,arch)}.manifest.json`;
const FILES=[...TARGETS.map(([p,a])=>binaryName(p,a)),...TARGETS.map(([p,a])=>manifestName(p,a)),SKILLS].sort();
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

class Refusal extends Error {}
const refuse=message=>{throw new Refusal(message);};

/** The release identity every file must carry: the package version and the contract's protocol. */
async function release(){
 const {version}=JSON.parse(await readFile(join(cli,'package.json'),'utf8'));
 const match=/CLI_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(await readFile(join(repository,'services/contracts/src/cli-auth.ts'),'utf8'));
 if(!/^\d+\.\d+\.\d+$/.test(version)||!match)refuse('services/cli/package.json or services/contracts/src/cli-auth.ts names no release');
 return {version,protocol:Number(match[1])};
}

/** The script pins the release it installs and the protocol it reports; both must be this release. */
function checkPins(text,{version,protocol},file){
 const pin=(name,value)=>new RegExp(`^${name}=${String(value).replaceAll('.','\\.')}$`,'m').test(text);
 if(!pin('AFBIN_VERSION',version))refuse(`${file}: AFBIN_VERSION is not ${version}`);
 if(!pin('AFBIN_PROTOCOL',protocol))refuse(`${file}: AFBIN_PROTOCOL is not ${protocol}`);
}

/** 0.3.21's safeSkillPath. */
const safeSkillPath=path=>!!path&&!isAbsolute(path)&&!path.includes('\\')&&path.split('/').every(x=>!!x&&x!=='.'&&x!=='..')&&path!=='.afbin-skill.json';

function checkSkills(bytes,{version,protocol}){
 if(bytes.length>SKILLS_LIMIT)refuse(`${SKILLS}: larger than ${SKILLS_LIMIT} bytes`);
 let bundle;try{bundle=JSON.parse(bytes.toString());}catch{refuse(`${SKILLS}: not JSON`);}
 if(bundle?.version!==version||bundle?.protocol!==protocol)refuse(`${SKILLS}: version/protocol is not ${version}/${protocol}`);
 if(!bundle.files||typeof bundle.files!=='object')refuse(`${SKILLS}: no files`);
 if(typeof bundle.files['SKILL.md']!=='string')refuse(`${SKILLS}: SKILL.md is missing`);
 for(const [path,content] of Object.entries(bundle.files)){
  if(!safeSkillPath(path))refuse(`${SKILLS}: unsafe path ${JSON.stringify(path)}`);
  if(typeof content!=='string')refuse(`${SKILLS}: ${path} is not a string`);
 }
}

async function build(out){
 const identity=await release();
 const script=await readFile(join(cli,'transition/afbin'));
 checkPins(script.toString(),identity,'services/cli/transition/afbin');
 let teaching;
 try{teaching=JSON.parse(await readFile(join(cli,'src/generated/teaching.json'),'utf8'));}
 catch(error){if(error.code==='ENOENT')refuse('services/cli/src/generated/teaching.json is missing: run npm run generate:teaching -w services/cli');throw error;}
 const skills=Buffer.from(JSON.stringify({...identity,files:teaching.files}));
 checkSkills(skills,identity);
 await mkdir(out,{recursive:true});
 await writeFile(join(out,SKILLS),skills);
 for(const [platform,arch] of TARGETS){
  const file=binaryName(platform,arch);
  await writeFile(join(out,file),script,{mode:0o755});await chmod(join(out,file),0o755);
  const manifest={...identity,platform,arch,binary:{file,sha256:sha256(script)},skills:{file:SKILLS,sha256:sha256(skills)}};
  await writeFile(join(out,manifestName(platform,arch)),JSON.stringify(manifest,null,2)+'\n');
 }
 console.log(`transition assets for afbin ${identity.version} (protocol ${identity.protocol}) written to ${out}`);
}

async function verify(dir){
 const identity=await release();
 const present=(await readdir(dir)).sort();
 const extra=present.filter(name=>!FILES.includes(name)),missing=FILES.filter(name=>!present.includes(name));
 if(missing.length||extra.length)refuse(`${dir}: expected exactly the nine transition files (missing ${missing.join(', ')||'none'}; extra ${extra.join(', ')||'none'})`);
 const source=await readFile(join(cli,'transition/afbin'));
 checkPins(source.toString(),identity,'services/cli/transition/afbin');
 const skills=await readFile(join(dir,SKILLS));
 checkSkills(skills,identity);
 for(const [platform,arch] of TARGETS){
  const file=binaryName(platform,arch),manifestFile=manifestName(platform,arch);
  const binary=await readFile(join(dir,file));
  checkPins(binary.toString(),identity,file);
  if(!binary.equals(source))refuse(`${file}: differs from services/cli/transition/afbin`);
  const bytes=await readFile(join(dir,manifestFile));
  if(bytes.length>MANIFEST_LIMIT)refuse(`${manifestFile}: larger than ${MANIFEST_LIMIT} bytes`);
  let manifest;try{manifest=JSON.parse(bytes.toString());}catch{refuse(`${manifestFile}: not JSON`);}
  const expected={...identity,platform,arch,binary:{file,sha256:sha256(binary)},skills:{file:SKILLS,sha256:sha256(skills)}};
  for(const digest of [manifest?.binary?.sha256,manifest?.skills?.sha256])if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))refuse(`${manifestFile}: sha256 is not lowercase 64-hex`);
  if(JSON.stringify(manifest)!==JSON.stringify(expected))refuse(`${manifestFile}: does not match ${file} and ${SKILLS} at ${identity.version}/${identity.protocol}`);
 }
 // The updater's own acceptance check. Through sh: downloaded CI artifacts lose their execute bits.
 if(process.platform!=='win32'){
  const host=binaryName(process.platform,process.arch);
  if(FILES.includes(host)){
   let output;
   try{output=execFileSync('env',['-i','sh',join(dir,host),'--version','--json'],{encoding:'utf8',timeout:15000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});}
   catch(error){refuse(`${host}: --version --json failed in an empty environment (${String(error.message).split('\n')[0]})`);}
   const want=JSON.stringify(identity);
   if(output.trim()!==want)refuse(`${host}: --version --json printed ${JSON.stringify(output.trim())}, not ${want}`);
  }
 }
 console.log(`transition assets in ${dir} verified for afbin ${identity.version} (protocol ${identity.protocol})`);
}

const [command,target]=process.argv.slice(2);
try{
 if(command==='build'&&target)await build(resolve(target));
 else if(command==='verify'&&target){if(!(await stat(target).catch(()=>null))?.isDirectory())refuse(`${target}: not a directory`);await verify(resolve(target));}
 else refuse('Usage: node transition-assets.mjs build <outDir> | verify <dir>');
}catch(error){
 // One line, naming the file: a refusal says what is wrong; anything else (a missing file) says what failed.
 console.error(`transition assets: ${error instanceof Refusal?error.message:String(error?.message??error).split('\n')[0]}`);process.exit(1);
}
