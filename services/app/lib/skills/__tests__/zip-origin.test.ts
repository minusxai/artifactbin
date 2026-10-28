import {expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {GET} from '@/app/skills/artifactbin.zip/route';
import {overrideConfig} from '@/lib/platform/config';

async function installedServer(url:string):Promise<{config:string;skill:string}>{
 const response=await GET(new Request(url));
 const root=mkdtempSync(path.join(tmpdir(),'skill-origin-'));
 try{
  const zip=path.join(root,'skill.zip');writeFileSync(zip,new Uint8Array(await response.arrayBuffer()));
  execFileSync('unzip',['-q',zip,'-d',root]);
  return {config:readFileSync(path.join(root,'artifactbin/scripts/toolbox-config.mjs'),'utf8'),skill:readFileSync(path.join(root,'artifactbin/SKILL.md'),'utf8')};
 }finally{rmSync(root,{recursive:true,force:true});}
}

it('names the canonical origin when the archive is fetched through an alias',async()=>{
 overrideConfig({publicBaseUrl:'https://app.canonical.example',aliasOrigins:['https://app.previous.example']});
 const {config,skill}=await installedServer('https://app.previous.example/skills/artifactbin.zip');
 expect(config).toBe('export default "https://app.canonical.example";\n');
 expect(skill).toContain('Server: https://app.canonical.example.');
 expect(skill).not.toContain('app.previous.example');
});

it('keeps the request origin for a host that is not an alias',async()=>{
 overrideConfig({publicBaseUrl:'https://app.canonical.example',aliasOrigins:['https://app.previous.example']});
 const {config}=await installedServer('https://other.example/skills/artifactbin.zip');
 expect(config).toBe('export default "https://other.example";\n');
});
