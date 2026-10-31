import {describe,it,expect} from 'vitest';
import {buildGroupSetupInstructions,buildSetupInstructions} from '../setup-instructions';
describe('shared recipient setup instructions',()=>{
 it('uses supplied deployment identity and recipient authentication for both transports',()=>{
  const text=buildGroupSetupInstructions({serverOrigin:'https://team.example/',groupHandle:'research'});
  expect(text).toContain('https://team.example/skills/artifactbin.zip');
  expect(text).toContain('https://artifactbin.dev/install.sh');
  expect(text).not.toMatch(/afbin |@afbin\/cli/);
  expect(text).toContain('GET /api/groups/research');expect(text).toContain('PUT /api/me/preferences');
  expect(text).toContain('"id":"<resolved group.id>"');expect(text).toContain('sender’s login is never transferred');
  expect(text).toContain('viewers');expect(text).not.toContain('app.artifactbin.dev');
 });
 it('ordinary deployment instructions omit group and explicit default while reusing one workflow',()=>{
  const text=buildSetupInstructions({serverOrigin:'http://app.lvh.me:8201'});
  expect(text).toContain('http://app.lvh.me:8201/llms.txt');expect(text).not.toContain('--set-default');
  expect(text).toContain('reuse saved credentials');expect(text).toContain('/llms/http-auth');
 });
 it('rejects handle injection and non-origin URLs',()=>{
  expect(()=>buildGroupSetupInstructions({serverOrigin:'https://team.example',groupHandle:"research'; evil"})).toThrow();
  expect(()=>buildSetupInstructions({serverOrigin:'javascript:evil'})).toThrow();
 });
});
