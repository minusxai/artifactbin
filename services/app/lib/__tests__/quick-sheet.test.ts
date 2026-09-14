import {describe,it,expect} from 'vitest';
import {buildQuickSheet,renderDoc,skillExample} from '../skills';
import teaching from '../../../cli/src/generated/teaching.json';
const sheet=buildQuickSheet('https://artifactbin.dev');
describe('the installed short skill',()=>{
 it('fits its reading budget and uses local guidance',()=>{
  expect(sheet).toContain('afbin help');
  // The retired vocabulary (MCP, /docs/, token, mint, /raw, …) is banned across all
  // nine agent-facing surfaces at once by agent-starter-consistency.test.ts, case (c).
 });
 /**
  * A person is waiting on a blank page. The FIRST wording of this rule was exhortative ("publish a
  * FIRST version in your first few calls") and MEASURED not to move anything: on local21, six tasks
  * across pi and opencode, the first markup write landed at 156–366 s and every task published
  * exactly one version. So the rule is now countable — three calls of the pull, and a first push
  * carrying only the title and the section headings — because an agent can check a count against
  * its own transcript and cannot check "early". The tests follow: they assert the NUMBER and the
  * CONTENT of that first push, not the encouragement.
  *
  * The second bullet keeps that first version native: the kit covers the content, `<Iframe>` is the
  * escape hatch for an isolated script or canvas, never a layout tool. Both are asserted on the
  * BULLET, not the page, so a stray sentence elsewhere cannot satisfy them, and on the shipped
  * `teaching.json` too — the generated bundle is the copy the CLI actually hands an agent.
  */
 it('counts the first push — three calls, title and headings — then fills sections, and native markup before Iframe',()=>{
  const bullet=(start:string)=>sheet.split('\n').find(line=>line.startsWith(start))!;
  const fewTurns=bullet('- Few turns');
  expect(fewTurns).toBeDefined();
  // Countable, not exhortative: a number of calls and a named payload for the first push.
  expect(fewTurns).toContain('push a FIRST version within three calls of the pull');
  expect(fewTurns).toMatch(/title and section headings, one line each/);
  expect(fewTurns).toMatch(/fill the sections in later pushes/);
  expect(fewTurns).toContain('waiting on a blank page');
  expect(fewTurns).toMatch(/is not re-checking/);
  // Vague encouragement is the failure mode this replaced; it must not come back.
  for(const vague of ['first few calls','early','as soon as you can'])expect(fewTurns,vague).not.toContain(vague);
  // The verification rule is kept verbatim, not softened by the new flow.
  expect(fewTurns).toContain('A successful push IS the verification');
  expect(fewTurns).toMatch(/Skip pulling, diffing, exporting[^.]*afterwards/);
  expect(fewTurns).not.toContain('write the whole document');
  expect(fewTurns.length).toBeLessThan(600);
  const native=bullet('- Native markup first');
  expect(native).toBeDefined();
  for(const text of ['text, data, charts, tables, controls and motion','<Iframe>','isolated DOM script or canvas','never for layout or content'])expect(native).toContain(text);
  // The bundle the CLI ships carries the same two bullets: a copy edit without
  // `npm run generate:teaching -w services/cli` leaves every agent on the old brief.
  expect(teaching.files['SKILL.md']).toContain('push a FIRST version within three calls of the pull');
  expect(teaching.files['SKILL.md']).toContain('- Native markup first');
  expect(teaching.files['SKILL.md']).not.toContain('write the whole document');
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
  expect(sheet).toContain('whether or not you can view images');expect(sheet).toContain('every slide, in one image');
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
