import {describe,expect,it} from 'vitest';
import {agentDiscovery} from '@/lib/platform/agent-discovery';
import {agentDiscoveryHead,agentDiscoveryTail} from '@/lib/serving/agent-discovery';
import {gettingStarted} from '@/lib/serving/getting-started';
import {existingPaste} from '@/lib/serving/agent-copy';
import {skillTree} from '@/lib/skills';
import {skillPackageFiles} from '@/lib/skills/package';
import {publicGuideText,llmsText} from '@/lib/serving/agent-references.server';
import {buildSetupInstructions} from '@/lib/platform/setup-instructions';
const BASE='https://example.test';
describe('skill-first HTTP onboarding',()=>{
 it('hands agents the same tokenless HTTP guide on every entry point',()=>{
  const discovery=agentDiscovery(BASE);
  for(const text of [discovery.instruction,agentDiscoveryHead(discovery),agentDiscoveryTail(discovery),existingPaste(BASE,'example'),JSON.stringify(gettingStarted(BASE)),buildSetupInstructions({serverOrigin:BASE})]){
   expect(text).toContain(`${BASE}/llms.txt`);
   expect(text).not.toMatch(/afbin |@afbin\/cli|install\.sh|name="cli"|device approval/i);
  }
 });
 it('provides skill installation and actual HTTP authoring and auth contracts',()=>{
  const guide=JSON.stringify(gettingStarted(BASE));
  expect(guide).toContain(`${BASE}/skills/artifactbin.zip`);
  expect(guide).toContain('unzip -n');
  const brief=llmsText(BASE);
  expect(brief).toContain('POST /api/artifacts');
  expect(brief).toContain('expectedState');
  expect(brief).toContain('/llms/http-auth');
  expect(brief).not.toMatch(/afbin |@afbin\/cli|chat\/install|CLI was selected/);
 });
 it('excludes retired command guides from HTTP discovery and the downloadable skill',()=>{
  const files=skillPackageFiles(skillTree(),BASE);
  for(const topic of ['npm-local','publishing-auth','commands','remote-review','markdown']){
   expect(files).not.toHaveProperty(`references/${topic}.md`);
   expect(publicGuideText(topic,BASE)).toBeNull();
  }
  for(const [file,text] of Object.entries(files)){
   expect(text,file).not.toMatch(/@afbin\/cli|chat\/(?:install|ensure-node)/);
   for(const [,target] of text.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)){
    const key=target.startsWith('references/')?target:target==='../SKILL.md'?'SKILL.md':file.startsWith('references/')?'references/'+target:target;
    expect(files,key).toHaveProperty(key);
   }
  }
 });
});
