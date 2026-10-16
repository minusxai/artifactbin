import {describe,it,expect} from 'vitest';
import {skillExample,stripBundleMarkers,condenseForBundle} from '../skills';
import {QUICK_SHEET_MAX_BYTES,buildQuickSheet,renderDoc} from '@/test/helpers/skill-docs';
import teaching from '../../../cli/src/generated/teaching.json';
const sheet=buildQuickSheet('https://artifactbin.dev');
describe('the installed short skill',()=>{
 it('routes interactive wireframes to saved-view authoring guidance in both served and bundled teaching',()=>{
  const bundled=teaching.files as Record<string,string>;
  for(const text of [sheet,teaching.files['SKILL.md']]){
   expect(text).toContain('references/review-state.md');
   expect(text.toLowerCase()).toContain('wireframes');
  }
  for(const topic of ['templates-app','templates-plan','markup-state','markup-scripts']){
   for(const text of [renderDoc(`artifactbin/references/${topic}.md`,'https://example.test'),bundled[`references/${topic}.md`]])expect(text,topic).toContain('(review-state.md)');
  }
  const guide=teaching.files['references/review-state.md'];
  for(const text of ['createSignal',"{ name: 'checkout' }",'Nothing registers','false','Reload','current artifact','never saved'])expect(guide).toContain(text);
 });
 it('fits its reading budget and uses local guidance',()=>{
  expect(sheet).toContain('afbin help');
  // The retired vocabulary (MCP, /docs/, token, mint, /raw, …) is banned across every
  // agent-facing surface at once by agent-starter-consistency.test.ts, case (c).
 });
 it('shares useful content before visual checks, with the same rule in HTTP authoring',()=>{
  for(const text of [sheet,teaching.files['SKILL.md'],renderDoc('artifactbin/references/http-authoring.md','https://example.test')]){
   expect(text).toContain('Save a complete small edit');
   expect(text).toContain('useful first version');
   expect(text).toContain('Share its URL immediately, before visual checks');
   expect(text).toContain('Never publish an empty scaffold');
   expect(text).not.toContain('Within six calls');
  }
  expect(Buffer.byteLength(sheet)).toBeLessThan(QUICK_SHEET_MAX_BYTES);
  expect(sheet).toContain('Push confirms source acceptance');
  expect(sheet).toContain('do not pull, diff or grep just to reconfirm it');
  expect(sheet).toContain('Publishing does not verify appearance');
  const native=sheet.split('\n').find(line=>/^(?:- )?Use Helmet `<script>`/.test(line))!;
  for(const text of ['(Solid, npm)','for behaviour','exported components mount by name'])expect(native).toContain(text);
  expect(teaching.files['SKILL.md']).toContain(native);
  expect(sheet).not.toContain('<Iframe>');
 });
 it('uses the same push for create and update with local validation',()=>{
  for(const text of ['afbin pull','afbin push report.jsx','new artifact','validates/publishes'])expect(sheet).toContain(text);
  // The publishing guide naming ~/.artifactbin/state.sqlite is
  // agent-docs-batch-identity.test.ts's assertion, in the whole sentence.
  expect(sheet).toContain('YAML metadata fence');
  for(const term of ['self-contained HTML','kit JSX','Tailwind utilities using `className`'])expect(sheet.slice(0,sheet.indexOf('npm CLI:'))).toContain(term);
  expect(sheet).toContain('edit_id');
 });
 it('routes new work to its selected guides before writing and inherits design for edits',()=>{
  const content=sheet.split('## 3. Shape the content')[1]!.split('## 4.')[0]!;
  for(const topic of ['templates','design-systems','copy','design','markup'])expect(content).toContain(`references/${topic}.md`);
  expect(content).toContain('inherit the existing page type and design');
  expect(content).toContain('BEFORE writing');
  expect(content).toContain('one design system');
 });
 it('teaches responsive containers, static JSX and appropriate chart primitives through the example',()=>{
  for(const term of ['@2xl:','phone width','static JSX','className','<Helmet>','CDN','custom CSS lives here','never hand-rolled <svg>'])expect(sheet).toContain(term);
  // The example being inlined verbatim is agent-starter-consistency.test.ts's assertion — it pins
  // the surrounding ```jsx fence too.
 });
 it('points to data, comments, history and recovery without another network reference',()=>{
  for(const topic of ['markup-data','publishing-annotations','publishing-auth','publishing','errors','commands'])expect(sheet).toContain(`references/${topic}.md`);
  expect(sheet).toContain('On refusal');
  expect(sheet).toContain('--json');
  expect(sheet).toContain('Publishing does not verify appearance');
  expect(sheet).toContain('whole-document/all-slide');
  expect(sheet).toContain('afbin export <artifact-url> --output out.png');
  expect(sheet).toContain('URL/`--refresh` uses server, files/IDs local');
  const versions=renderDoc('artifactbin/references/publishing-versions.md','https://example.test');
  for(const term of ['the whole document, every slide, in one image','never one slide at a time'])expect(versions).toContain(term);
  const commands=renderDoc('artifactbin/references/commands.md','https://example.test');
  expect(commands).toContain('afbin <command> -h');
  expect(renderDoc('artifactbin/references/publishing-versions.md','https://example.test')).toContain('Delete retains local files');
  const annotations=renderDoc('artifactbin/references/publishing-annotations.md','https://example.test');
  for(const flag of ['--thread','--state resolved','--quote'])expect(annotations).toContain(flag);
 });
 it('every concrete link exists in the shipped local bundle',()=>{
  for(const [,link] of sheet.matchAll(/\]\((references\/[^)]+)\)/g))expect(teaching.files).toHaveProperty(link.split('#')[0]!);
 });
 it('teaches canonical refs and bindings without retired forms',()=>{
  expect(sheet).toContain('ref:<id>');
  expect(sheet).toContain('sales.rows');
  expect(sheet).toContain('$monthly');
  for(const dead of ['<Param','data="ref:','ref_<id>','"markdown"','"html"','public.rows','source="ref:abc123"'])expect(sheet).not.toContain(dead);
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
  expect(teaching.files['SKILL.md']).toMatch(/^---\nname: artifactbin\ndescription: "Create, edit, publish, comment on/);
  expect(teaching.files['SKILL.md']).toContain(skillExample().trimEnd());
  expect((teaching as {example:string}).example).toBe(skillExample());
 });
});
