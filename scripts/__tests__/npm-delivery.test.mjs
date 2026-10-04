import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
const npmCli=process.env.npm_execpath??realpathSync(spawnSync('/bin/sh',['-c','command -v npm'],{encoding:'utf8'}).stdout.trim());
const pack=new URL('../../services/cli/scripts/pack-release.mjs',import.meta.url);
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'afbin-pack-'));try{
 const cli=join(root,'services/cli');await mkdir(join(cli,'scripts'),{recursive:true});await mkdir(join(cli,'dist/runtime'),{recursive:true});
 await cp(pack,join(cli,'scripts/pack-release.mjs'));
 await writeFile(join(cli,'scripts/prepare-pty.mjs'),'// fixture postinstall\n');
 await writeFile(join(cli,'dist/afbin.mjs'),'#!/usr/bin/env node\nconsole.log("fixture-0.1.0");\n',{mode:0o755});
 await writeFile(join(cli,'package.json'),JSON.stringify({name:'@artifactbin/cli',version:'0.1.0',type:'module',bin:{afbin:'dist/afbin.mjs'},files:['dist','scripts/prepare-pty.mjs','npm-shrinkwrap.json'],scripts:{postinstall:'node scripts/prepare-pty.mjs'}}));
 await writeFile(join(cli,'npm-shrinkwrap.json'),JSON.stringify({name:'@artifactbin/cli',version:'0.1.0',lockfileVersion:3,requires:true,packages:{'':{name:'@artifactbin/cli',version:'0.1.0'}}}));
 await run(root,cli);
}finally{await rm(root,{recursive:true,force:true});}}
function packFixture(root,cli){return spawnSync(process.execPath,[join(cli,'scripts/pack-release.mjs'),join(root,'packed')],{cwd:root,env:{...process.env,npm_execpath:npmCli,npm_config_cache:join(root,'cache')},encoding:'utf8',timeout:30000});}
it('packs a standalone locked npm tarball that installs outside its checkout',()=>fixture(async(root,cli)=>{
 const result=packFixture(root,cli);expect(result.status,result.stderr).toBe(0);
 const file=join(root,'packed/artifactbin-cli-0.1.0.tgz');
 const manifest=JSON.parse(spawnSync('tar',['-xOf',file,'package/package.json'],{encoding:'utf8'}).stdout);expect(manifest.name).toBe('@artifactbin/cli');
 const lock=JSON.parse(spawnSync('tar',['-xOf',file,'package/npm-shrinkwrap.json'],{encoding:'utf8'}).stdout);expect(lock.packages[''].version).toBe('0.1.0');
 const consumer=join(root,'consumer');await mkdir(consumer);
 const installed=spawnSync(process.execPath,[npmCli,'install','--prefix',consumer,'--offline','--no-audit','--no-fund',file],{env:{...process.env,npm_execpath:npmCli,npm_config_cache:join(root,'cache')},encoding:'utf8'});expect(installed.status,installed.stderr).toBe(0);
 const launched=spawnSync(process.execPath,[join(consumer,'node_modules/@artifactbin/cli/dist/afbin.mjs')],{encoding:'utf8'});expect(launched.stdout.trim()).toBe('fixture-0.1.0');
}),30000);
it('refuses build-machine runtime dependencies instead of packing a platform-specific npm release',()=>fixture(async(root,cli)=>{
 await mkdir(join(cli,'dist/runtime/node_modules/sharp'),{recursive:true});
 const result=packFixture(root,cli);expect(result.status).not.toBe(0);expect(result.stderr).toContain('build-machine');
}),30000);
