import {describe,it,expect} from 'vitest';
import {skillExample,stripBundleMarkers,condenseForBundle} from '../skills';
import {buildQuickSheet,renderDoc} from '@/test/helpers/skill-docs';
import teaching from '../../../cli/src/generated/teaching.json';
const sheet=buildQuickSheet('https://artifactbin.dev');
describe('the installed short skill',()=>{
 it('routes interactive wireframes to saved-view authoring guidance in both served and bundled teaching',()=>{
  const bundled=teaching.files as Record<string,string>;
  for(const text of [sheet,teaching.files['SKILL.md']]){
   expect(text).toContain('afbin help review-state');
   expect(text).toContain('wireframes');
  }
  for(const topic of ['templates-app','templates-plan','markup-state','markup-scripts']){
   for(const text of [renderDoc(`artifactbin/references/${topic}.md`,'https://example.test'),bundled[`references/${topic}.md`]])expect(text,topic).toContain('(review-state.md)');
  }
  const guide=teaching.files['references/review-state.md'];
  for(const text of ['reviewState','get: view','restore: saved => setView(saved)','false','Reload','current artifact','No registration'])expect(guide).toContain(text);
 });
 it('fits its reading budget and uses local guidance',()=>{
  expect(sheet).toContain('afbin help');
  // The retired vocabulary (MCP, /docs/, token, mint, /raw, …) is banned across every
  // agent-facing surface at once by agent-starter-consistency.test.ts, case (c).
 });
 /**
  * A person is waiting on a blank page. The FIRST wording of this rule was exhortative ("publish a
  * FIRST version in your first few calls") and MEASURED not to move anything: on local21, six tasks
  * across pi and opencode, the first markup write landed at 156–366 s and every task published
  * exactly one version. So the rule is countable — six calls of the pull, and a first push carrying
  * the fence with its system, the title, real opening copy and one substantive section (a designed
  * first impression, since 3 Oct 2026; headings alone was the slop the taste work found) — because an agent can check a count against
  * its own transcript and cannot check "early". The tests follow: they assert the NUMBER and the
  * CONTENT of that first push, not the encouragement.
  *
  * The second bullet splits the work: markup carries content, data and layout, and the Helmet
  * script (Solid, any npm library) carries behaviour, its exported components mounted
  * by name. Both are asserted on the BULLET, not the page, so a stray sentence elsewhere cannot
  * satisfy them, and on the shipped `teaching.json` too — the generated bundle is the copy the CLI
  * actually hands an agent.
  */
 it('counts the first push — six calls, a designed opening — then fills the rest, and markup for content, the script for behaviour',()=>{
  const bullet=(start:string)=>sheet.split('\n').find(line=>line.startsWith(start))!;
  const fewTurns=bullet('- Read `afbin help <page type>`');
  expect(fewTurns).toBeDefined();
  const httpAuthoring=renderDoc('artifactbin/references/http-authoring.md','https://example.test');
  const progression='Within six calls of reading the artifact, publish a first version with metadata, title, real opening copy and one substantive section; extend it in later edits.';
  expect(fewTurns).toContain(progression);
  expect(teaching.files['SKILL.md']).toContain(progression);
  expect(httpAuthoring).toContain(progression);
  expect(httpAuthoring).toContain('URL-only requests get the URL alone.');
  expect(httpAuthoring).toContain('At 390px, fix overflow, clipping and unreachable controls.');
  expect(Buffer.byteLength(sheet)).toBeLessThan(8192);
  expect(Buffer.byteLength(httpAuthoring)).toBeLessThan(8192);
  // Countable, not exhortative: a number of calls and a named payload for the first push.
  expect(fewTurns).toMatch(/metadata, title, real opening copy and one substantive section/);
  expect(fewTurns).toMatch(/extend it in later edits/);
  expect(fewTurns).toContain('choose ONE design system');
  // Vague encouragement is the failure mode this replaced; it must not come back.
  for(const vague of ['first few calls','early','as soon as you can'])expect(fewTurns,vague).not.toContain(vague);
  // Publication acceptance and visual review are distinct checks.
  expect(fewTurns).toContain('Push confirms source acceptance');
  expect(fewTurns).toContain('do not pull, diff or grep just to reconfirm it');
  expect(sheet).toContain('Publishing does not verify appearance');
  expect(fewTurns).not.toMatch(/Skip[^.]*exporting/);
  expect(fewTurns).not.toContain('write the whole document');
  expect(fewTurns.length).toBeLessThan(600);
  const native=bullet('- The kit covers content, layout');
  expect(native).toBeDefined();
  for(const text of ['content, layout, data, charts, tables, controls and motion','Helmet `<script>`','(Solid, npm)','for behaviour','exported components mount by name'])expect(native).toContain(text);
  // The managed frame is gone: the brief must not send an agent to it.
  expect(sheet).not.toContain('<Iframe>');
  // The bundle the CLI ships carries the same two bullets: a copy edit without
  // `npm run generate:teaching -w services/cli` leaves every agent on the old brief.
  expect(teaching.files['SKILL.md']).toContain(fewTurns);
  expect(teaching.files['SKILL.md']).toContain(native);
  expect(teaching.files['SKILL.md']).not.toContain('write the whole document');
 });
 it('uses the same push for create and update with local validation',()=>{
  for(const text of ['afbin pull','afbin push report.jsx','new artifact','afbin validate'])expect(sheet).toContain(text);
  // The publishing guide naming ~/.artifactbin/state.sqlite is
  // agent-docs-batch-identity.test.ts's assertion, in the whole sentence.
  expect(sheet).toContain('YAML fence');
  for(const term of ['self-contained HTML','kit JSX','Tailwind `className`'])expect(sheet.slice(0,sheet.indexOf('npm CLI:'))).toContain(term);
  expect(sheet).toContain('edit_id');
 });
 it('routes design and vocabulary before the chosen page type and design system',()=>{
  const positions=['references/design.md','references/markup.md','references/templates-<name>.md','references/design-systems.md'].map(s=>sheet.indexOf(s));
  expect(positions.every(x=>x>=0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(sheet).toContain('afbin help design-systems');
  expect(sheet).toContain('afbin help templates');
 });
 it('teaches responsive containers, static JSX and appropriate chart primitives through the example',()=>{
  for(const term of ['@2xl:','phone width','static JSX','className','<Helmet>','CDN','custom CSS lives here','never hand-rolled <svg>'])expect(sheet).toContain(term);
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
  expect(sheet).toContain('the design system carries the palette');
  expect(sheet).toContain('does not verify appearance');
  expect(sheet).toContain('For visual review');
  for(const term of ['Files/registered IDs use local data, unchanged by server mutations','afbin export <artifact-url> --output out.png','ID with `--refresh`','fresh published image; refuses local paths','references/publishing-versions.md'])expect(sheet).toContain(term);
  const annotations=renderDoc('artifactbin/references/publishing-annotations.md','https://example.test');
  for(const flag of ['--thread','--state resolved','--quote'])expect(annotations).toContain(flag);
 });
 it('every concrete link exists in the shipped local bundle',()=>{
  for(const [,link] of sheet.matchAll(/\]\((references\/[^)]+)\)/g))expect(teaching.files).toHaveProperty(link);
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
  expect(teaching.files['SKILL.md']).toMatch(/^---\nname: artifactbin\ndescription: "Required for every artifactbin task/);
  expect(teaching.files['SKILL.md']).toContain(skillExample().trimEnd());
  expect((teaching as {example:string}).example).toBe(skillExample());
 });
});
