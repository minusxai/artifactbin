import {describe,it,expect} from 'vitest';
import {buildQuickSheet,renderDoc,skillExample,stripBundleMarkers,condenseForBundle} from '../skills';
import teaching from '../../../cli/src/generated/teaching.json';
const sheet=buildQuickSheet('https://artifactbin.dev');
describe('the installed short skill',()=>{
 it('fits its reading budget and uses local guidance',()=>{
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
  expect(sheet).toContain('whether or not you can view images');expect(sheet).toContain('every slide, in one image');
  // Nothing ELSE is needed to make it look right. The checking bullet is where an agent decides what
  // more to reach for, so it says there is nothing more: a theme carries the palette, so a design
  // skill, a palette tool or image tooling is a turn spent on something the document already has.
  expect(sheet).toContain('no other skill, palette tool or image tooling is needed');
  expect(sheet).toContain('the theme carries the palette');
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
 /**
  * ONE SOURCE, TWO LENGTHS. A reference marks the prose its bundled copy can do without; the full
  * rendering must come out exactly as if the markers were never written, or `/docs`, the installed
  * `references/` files and `afbin help <topic>` would quietly lose text meant only for the bundle.
  */
 it('drops a marked span from the bundled copy and no byte from the full one',()=>{
  const marked='## Rule\n\nKeep this.\n<!--bundle:skip-->\nMeasured on run 15: drop this.\n<!--/bundle:skip-->\nAnd this<!--bundle:skip--> (not this)<!--/bundle:skip-->.\n';
  expect(stripBundleMarkers(marked)).toBe('## Rule\n\nKeep this.\nMeasured on run 15: drop this.\nAnd this (not this).\n');
  expect(condenseForBundle(marked)).toBe('## Rule\n\nKeep this.\nAnd this.\n');
  expect(stripBundleMarkers('nothing marked')).toBe('nothing marked');
 });
 it('ships no marker in any reference, and every condensed copy is shorter than the file it came from',()=>{
  const files=teaching.files as Record<string,string>;
  const condensed=(teaching as {condensed:Record<string,string>}).condensed;
  for(const [path,text] of Object.entries(files))expect(text,path).not.toContain('bundle:skip');
  expect(Object.keys(condensed).length,'the bundled references are marked').toBeGreaterThan(0);
  for(const [path,text] of Object.entries(condensed)){
   expect(files[path],path).toBeDefined();
   expect(Buffer.byteLength(text),path).toBeLessThan(Buffer.byteLength(files[path]!));
   expect(text,path).not.toContain('bundle:skip');
  }
 });
 it('the bundle carries the brief with its frontmatter and the example as a help topic',()=>{
  expect(teaching.files['SKILL.md']).toMatch(/^---\nname: artifactbin\ndescription: "Required for every artifactbin task/);
  expect(teaching.files['SKILL.md']).toContain(skillExample().trimEnd());
  expect((teaching as {example:string}).example).toBe(skillExample());
 });
});
