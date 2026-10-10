import {renderSetupInstaller} from '@/lib/serving/setup-installers';
import type {DeploymentState} from '@artifactbin/contracts';
import {describe,it,expect} from 'vitest';
import {useAppHarness,request} from './harness';
import {overrideConfig} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import {GET as markdown} from '@/app/getting-started.md/route';
import {createAppServer} from '@/server/app';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
useAppHarness();
const company=()=>overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'mxmx_test_owner@example.com'});
const server=()=>createAppServer({indexHtml:async()=>'<div>SPA</div>',publicDir:resolve(__dirname,'../public')});
const headers={'x-forwarded-proto':'https','x-forwarded-host':'company.example.test'};
async function confirm(){const db=await getDb();await db.query("INSERT INTO groups(id,handle,name,created_by) VALUES ('grp_company','company-team','Company','owner')");await db.query("INSERT INTO deployment_state(id,owner_user_id,default_group_id,setup_complete) VALUES ('company','owner','grp_company',true)");}
describe('deployment-aware recipient setup',()=>{
 it('completed company Markdown teaches the same recipient group/default command as group copy',async()=>{
  company();await confirm();const text=await(await markdown(request('/getting-started.md'))).text();
  expect(text).toContain("--group 'company-team' --set-default");expect(text).toContain('PUT /api/me/preferences');expect(text).not.toContain('grp_company');
 });
 it('incomplete company setup selects only this server and does not advertise a group',async()=>{
  company();const text=await(await markdown(request('/getting-started.md'))).text();expect(text).toContain('--set-default');expect(text).not.toContain('--group');
  const script=await(await server().request('/chat/install.sh',{headers})).text();expect(script).toContain('--set-default');expect(script).not.toContain('--group');
 });
 it('the actual served company shell forwards explicit recipient group and host defaults as arguments',async()=>{
  company();await confirm();const script=await(await server().request('/chat/install.sh',{headers})).text();
  const dir=mkdtempSync(join(tmpdir(),'afbin-company-install-'));const bin=join(dir,'tools');mkdirSync(bin);
  try{
   writeFileSync(join(bin,'curl'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then output="$2"; shift; fi; shift; done\nprintf ":\\n" > "$output"\n',{mode:0o755});
   writeFileSync(join(bin,'npx'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$AFBIN_PROBE/npm-args"\n',{mode:0o755});
   const run=spawnSync('sh',[],{input:script,encoding:'utf8',cwd:dir,env:{PATH:`${bin}:/usr/bin:/bin`,HOME:dir,AFBIN_PROBE:dir},timeout:10000});
   expect(run.status,run.stderr).toBe(0);expect(readFileSync(join(dir,'npm-args'),'utf8')).toBe('--yes\n@afbin/cli@latest\nsetup\n--server\nhttps://company.example.test\n--group\ncompany-team\n--set-default\n');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('template selection flags escape apostrophes separately for shell and PowerShell',()=>{
  const state:DeploymentState={mode:'company',setup_complete:true,is_owner:false,default_group:{id:'id',handle:"team'$(echo injected)",name:'Team',description:'',role:null}};
  const shell=renderSetupInstaller(`  origin=''\nbash -c '. "$1" && npx --yes @afbin/cli@latest setup --server "$2"' bash "$afbin_node_setup" "$origin"`,'https://company.example.test',state,'sh');
  expect(shell).toContain(`--group 'team'"'"'$(echo injected)' --set-default`);
  expect(shell).toContain('"${@:3}"');
  const run=spawnSync('/bin/bash',['-c',`afbin_node_setup=/dev/null\nnpx(){ printf '<%s>' "$@"; }; export -f npx\n${shell}`],{encoding:'utf8'});
  expect(run.status,run.stderr).toBe(0);expect(run.stdout).toContain("<--group><team'$(echo injected)><--set-default>");
  const powershell=renderSetupInstaller("$Origin = 'https://public.example'\nnpx.cmd --yes @afbin/cli@latest setup --server $Origin",'https://company.example.test',state,'powershell');
  expect(powershell).toContain("--group 'team''$(echo injected)' --set-default");
 });
 it('the actual served company PowerShell passes the confirmed group and explicit default',async()=>{
  company();await confirm();const script=await(await server().request('/chat/install.ps1',{headers})).text();
  expect(script).toContain("npx.cmd --yes @afbin/cli@latest setup --server $Origin --group 'company-team' --set-default");expect(script).not.toContain('grp_company');
 });
});
