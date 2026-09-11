import {describe,it,expect} from 'vitest';
import {buildQuickSheet,QUICK_SHEET_MAX_BYTES,renderDoc} from '../skills';
import teaching from '../../../cli/src/generated/teaching.json';
const sheet=buildQuickSheet('https://artifactbin.dev');
describe('the installed short skill',()=>{
 it('fits its reading budget and uses local guidance',()=>{
  expect(Buffer.byteLength(sheet)).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
  expect(sheet).toContain('afbin help');
  expect(sheet).not.toMatch(/MCP|\/docs\//);
 });
 it('uses the same push for create and update with local validation',()=>{
  for(const text of ['afbin pull','afbin push report.jsx','new artifact','afbin validate','afbin.lock']){
   expect(text==='afbin.lock'?renderDoc('artifactbin/references/publishing.md','https://example.test'):sheet).toContain(text);
  }
  expect(sheet).toContain('YAML fence');
  expect(sheet).toContain('edit_id');
 });
 it('routes design and vocabulary before the chosen template and theme',()=>{
  const positions=['references/design.md','references/markup.md','references/templates-<name>.md','references/themes-<name>.md'].map(s=>sheet.indexOf(s));
  expect(positions.every(x=>x>=0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(sheet).toContain('afbin help themes');
  expect(sheet).toContain('afbin help templates');
 });
 it('teaches responsive containers, static JSX and appropriate chart primitives',()=>{
  for(const term of ['grid-cols-1 @2xl:grid-cols-2','text-3xl @2xl:text-5xl','phone','static JSX','className','<Helmet>','No CDN scripts','inline style','never a hand-rolled `<svg>` chart'])expect(sheet).toContain(term);
 });
 it('points to data, comments, history and recovery without another network reference',()=>{
  for(const topic of ['markup-data','publishing-annotations','publishing-auth','errors'])expect(sheet).toContain(`references/${topic}.md`);
  for(const term of ['afbin comment','afbin log','afbin delete','--reply','--resolve','--json'])expect(sheet).toContain(term);
  expect(sheet).toContain('if you can view images');
 });
 it('every concrete link exists in the shipped local bundle',()=>{
  for(const [,link] of sheet.matchAll(/\]\((references\/[^)]+)\)/g))expect(teaching.files).toHaveProperty(link);
 });
 it('teaches canonical refs and bindings without retired forms',()=>{
  expect(sheet).toContain('ref:<id>');
  expect(sheet).toContain('public.rows');
  expect(sheet).toContain('$sales');
  for(const dead of ['<Param','data="ref:','ref_<id>','"markdown"','"html"'])expect(sheet).not.toContain(dead);
 });
});
