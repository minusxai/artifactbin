/** Produces one universal tarball with a consumer lock, isolated from workspace links. */
import {mkdtemp,cp,readFile,writeFile,rm,mkdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]??join(cli,'dist/packages'));
const stage=await mkdtemp(join(tmpdir(),'afbin-npm-pack-'));
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run npm run pack:release -w services/cli');
function run(args){return execFileSync(process.execPath,[npm,...args],{cwd:stage,stdio:['ignore','pipe','inherit'],encoding:'utf8'});}
try{
 try{await lstat(join(cli,'dist/runtime/node_modules'));throw new Error('Refusing build-machine runtime dependencies in universal npm package.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const manifest=JSON.parse(await readFile(join(cli,'package.json'),'utf8'));
 delete manifest.devDependencies;
 await writeFile(join(stage,'package.json'),JSON.stringify(manifest,null,2)+'\n');
 try{await cp(join(cli,'README.md'),join(stage,'README.md'));}catch(error){if(error.code!=='ENOENT')throw error;}
 try{await cp(resolve(cli,'../../LICENSE'),join(stage,'LICENSE'));}catch(error){if(error.code!=='ENOENT')throw error;}
 await cp(join(cli,'dist'),join(stage,'dist'),{recursive:true,filter:source=>!source.includes(`${join('dist','packages')}`)&&!source.endsWith('.tgz')});
 await mkdir(join(stage,'scripts'));await cp(join(cli,'scripts/prepare-pty.mjs'),join(stage,'scripts/prepare-pty.mjs'));
 // Consumer resolution produces registry dependencies, never repository workspace links.
 const lock=JSON.parse(await readFile(join(cli,'npm-shrinkwrap.json'),'utf8'));
 lock.version=manifest.version;lock.packages[''].version=manifest.version;
 await writeFile(join(stage,'npm-shrinkwrap.json'),JSON.stringify(lock,null,2)+'\n');
 run(['install','--package-lock-only','--ignore-scripts','--omit=dev','--no-audit','--no-fund']);
 await cp(join(stage,'npm-shrinkwrap.json'),join(cli,'npm-shrinkwrap.json'));
 await mkdir(output,{recursive:true});
 console.log(run(['pack','--json','--pack-destination',output]));
}finally{await rm(stage,{recursive:true,force:true});}
