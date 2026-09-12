import {describe,it,expect} from 'vitest';
import {buildQuickSheet,QUICK_SHEET_MAX_BYTES,renderDoc,skillExample} from '../skills';
import teaching from '../../../cli/src/generated/teaching.json';
const sheet=buildQuickSheet('https://artifactbin.dev');
describe('the installed short skill',()=>{
 it('fits its reading budget and uses local guidance',()=>{
  expect(Buffer.byteLength(sheet)).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
  expect(sheet).toContain('afbin help');
  // The retired vocabulary (MCP, /docs/, token, mint, /raw, …) is banned across all
  // nine agent-facing surfaces at once by agent-starter-consistency.test.ts, case (c).
 });
 it('uses the same push for create and update with local validation',()=>{
  for(const text of ['afbin pull','afbin push report.jsx','new artifact','afbin validate'])expect(sheet).toContain(text);
  // The publishing guide naming ~/.artifactbin/state.sqlite is
  // agent-docs-batch-identity.test.ts's assertion, in the whole sentence.
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
 it('teaches responsive containers, static JSX and appropriate chart primitives through the example',()=>{
  for(const term of ['@2xl:','phone width','static JSX','className','<Helmet>','CDN','never inline','never hand-rolled <svg>'])expect(sheet).toContain(term);
  // The example being inlined verbatim is skill-brief.test.ts's assertion — it pins
  // the surrounding ```jsx fence too.
 });
 it('points to data, comments, history and recovery without another network reference',()=>{
  for(const topic of ['markup-data','publishing-annotations','publishing-auth','publishing','errors','commands'])expect(sheet).toContain(`references/${topic}.md`);
  for(const term of ['afbin comment','afbin log','afbin delete','--json','On refusal'])expect(sheet).toContain(term);
  expect(sheet).toContain('if you can view images');
  const annotations=renderDoc('artifactbin/references/publishing-annotations.md','https://example.test');
  for(const flag of ['--thread','--state resolved','--quote'])expect(annotations).toContain(flag);
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
 it('the bundle carries the brief with its frontmatter and the example as a help topic',()=>{
  expect(teaching.files['SKILL.md']).toMatch(/^---\nname: artifactbin\ndescription: "Required for every artifactbin task/);
  expect(teaching.files['SKILL.md']).toContain(skillExample().trimEnd());
  expect((teaching as {example:string}).example).toBe(skillExample());
 });
});
