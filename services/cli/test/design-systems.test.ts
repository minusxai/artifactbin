import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {helpTopics} from '../src/teaching';

const REFERENCES=join(import.meta.dirname,'../../app/skills/artifactbin/references');

/**
 * The design systems are `kind: data` references, emitted by `npm run generate:design-systems` from
 * design-systems/specs into the skill tree (installed with the skill, printed by `afbin help system-<slug>`).
 * The runtime serves the CSS (lib/data/story/story-systems, from the same specs); a reference says what the agent gets.
 * This checks the bundled output — the shape an agent relies on at the bind step — so a regenerated
 * catalogue cannot silently lose a page type, a best-fit specimen, the fence line or the vocabulary,
 * and cannot start carrying CSS to paste again.
 */
const PAGE_TYPES=['Dashboard','Deck','Editorial','Scrolly','Plan','App','Landing'];
const SECTIONS=['## Read first','## Bind it','## Type roles','## Colour','## Components','## The hand','### Devices','## On each page type',"## Do and don't",'## What has no slot'];
const systems=Object.keys(helpTopics).filter(name=>/^system-[a-z]+$/.test(name));
const fenced=(text:string,lang:string)=>[...text.matchAll(new RegExp('```'+lang+'\\n([\\s\\S]*?)```','g'))].map(m=>m[1]!);

test('binding and page-type examples leave the system ground visible',()=>{
 for(const name of [...systems,...PAGE_TYPES.map(type=>`templates-${type.toLowerCase()}`)]){
  const text=helpTopics[name]!;
  const roots=[...text.matchAll(/<div data-design="tw" className="([^"]+)"/g)];
  assert.ok(roots.length,`${name}: document wrapper`);
  for(const root of roots)assert.ok(!root[1]!.split(/\s+/).some(c=>c.startsWith('bg-')),`${name}: opaque document wrapper`);
 }
});

test('thirteen systems are bundled, each a data reference in the skill tree',()=>{
 assert.equal(systems.length,13,systems.join(', '));
 // The bundle carries the rendered body; the frontmatter that declares the kind is on the source file.
 for(const name of systems){
  const source=readFileSync(join(REFERENCES,`${name}.md`),'utf8');
  assert.match(source,new RegExp(`^name: ${name}$`,'m'),`${name}: name`);
  assert.match(source,/^kind: data$/m,`${name}: kind`);
  assert.match(source,/^description: >-\n  \S/m,`${name}: description`);
 }
});

test('every system carries the sections an agent binds from, in order',()=>{
 for(const name of systems){
  const text='\n'+helpTopics[name]!; // the rendered body starts at its first heading
  let at=-1;
  for(const heading of SECTIONS){const i=text.indexOf(`\n${heading}\n`);assert.ok(i>at,`${name}: ${heading} missing or out of order`);at=i;}
  for(const type of PAGE_TYPES){
   const m=new RegExp(`^### ${type} · (best|good|avoid)$`,'m').exec(text);
   assert.ok(m,`${name}: ${type} rating`);
   if(m![1]==='best'){
    const section=text.slice(m!.index).split(/\n### /)[0]!; // this heading's section, up to the next
    assert.ok(/```jsx\n/.test(section),`${name}: ${type} is a best fit without its specimen markup`);
   }
  }
 }
});

test('a system binds by its fence line alone: no CSS to paste, the vocabulary the runtime provides, and one override example',()=>{
 for(const name of systems){
  const slug=name.slice('system-'.length);
  const text=helpTopics[name]!;
  assert.ok(text.includes(`1. Fence: \`theme: ${slug}\``),`${name}: the fence line`);
  assert.equal(fenced(text,'css').length,0,`${name}: carries CSS to paste`);
  assert.match(text,/```jsx\n<Helmet><style>\{`:root \{ --ds-[a-z0-9-]+: #[0-9a-f]{6}; \} \.dark \{ --ds-[a-z0-9-]+: #[0-9a-f]{6}; \}`\}<\/style><\/Helmet>\n```/,`${name}: the override example`);
  assert.match(text,/\| `t-[a-z0-9-]+` \|/,`${name}: the type roles table`);
  assert.match(text,/Classes the runtime provides: `[a-z]+-[a-z0-9-]+`/,`${name}: the class vocabulary`);
  assert.match(text,/\| `--ds-[a-z0-9-]+` \|/,`${name}: the token table`);
  assert.ok(!text.includes('@font-face'),`${name}: font rules belong to the runtime`);
  // Help is offline and self-hosted instances exist: a reference never points at a page one host has.
  assert.ok(!/\/a\/[A-Za-z0-9]{6}\b/.test(text),`${name}: names a hosted page`);
 }
});

test('the catalogue names every bundled system by its file, and no system the bundle lacks',()=>{
 const catalogue=helpTopics['design-systems']!;
 const named=[...catalogue.matchAll(/`(system-[a-z]+)\.md`/g)].map(m=>m[1]!);
 assert.deepEqual([...named].sort(),[...systems].sort());
});
