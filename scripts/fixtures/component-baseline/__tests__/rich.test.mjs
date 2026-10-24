import {describe,expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import {transformSync} from 'esbuild';
import {parseJsx} from '../../../../services/app/lib/jsx/parse';
import {validateJsx} from '../../../../services/app/lib/jsx/validate';
import {JSX_STORY_COMPONENT_NAMES} from '../../../../services/app/lib/jsx/components';
import {STORY_HTML_TAGS} from '../../../../services/app/lib/jsx/component-names';
import {richBaselineRevision,richBrowserParityFixtures,richBaselineReadiness} from '../rich.mjs';
describe('actual original/new rich reader fixture inputs',()=>{
 it('names all eleven public families and pins evidence sources without pretending captures exist',()=>{
  expect(richBrowserParityFixtures.map(f=>f.family)).toEqual(['Markdown','Mermaid','Isometric','DeckGL','SlideDeck','User','Avatar','Icon','Progress','DatePicker','Tooltip']);
  expect(new Set(richBrowserParityFixtures.map(f=>f.id)).size).toBe(richBrowserParityFixtures.length);
  for(const fixture of richBrowserParityFixtures){expect(fixture.provenance.revision).toBe(richBaselineRevision);expect(fixture.provenance.sources.length).toBeGreaterThan(1);for(const name of fixture.provenance.publicNames)expect(JSX_STORY_COMPONENT_NAMES).toContain(name);expect(fixture.limitations.length).toBeGreaterThan(0);expect(fixture.states[0]).toMatchObject({id:'initial',actions:[]});for(const state of fixture.states)expect(Object.keys(state.expected).length).toBeGreaterThan(0);}
 });
 for(const fixture of richBrowserParityFixtures)it(`${fixture.id} parses and validates as actual old JSX and has syntactically valid native setup`,()=>{
  const parsed=parseJsx(fixture.oldJsx);expect(parsed.ok,parsed.error).toBe(true);if(!parsed.ok)return;
  expect(validateJsx(parsed.nodes,{components:[...JSX_STORY_COMPONENT_NAMES,'Helmet','Query','Value'],allowedHtmlTags:STORY_HTML_TAGS,stylePolicy:'no-inline-style'})).toEqual([]);
  const doc=new JSDOM(fixture.newHtml).window.document;expect(doc.querySelector(`af-${fixture.modules[0]}`)).not.toBeNull();
  expect(()=>transformSync(fixture.setup||'',{loader:'js',format:'esm'})).not.toThrow();
 });
 it('keeps real engine readiness mandatory and basemaps network free',()=>{
  expect(Object.keys(richBaselineReadiness)).toEqual(['mermaid-flow','deck-gl-points','isometric-assembly']);
  const map=richBrowserParityFixtures.find(f=>f.family==='DeckGL');expect(map.oldJsx).toContain('basemap="none"');expect(map.setup).toContain('"basemap":"none"');expect(map.oldJsx).toContain('select 10 as longitude');expect(map.oldJsx).not.toMatch(/https?:\/\//);
  for(const fixture of richBrowserParityFixtures)expect(fixture.oldJsx+fixture.newHtml+(fixture.setup||'')).not.toMatch(/https?:\/\//);
  const mermaid=richBaselineReadiness['mermaid-flow'];expect(mermaid.jsx.toString()).toContain('naturalWidth');expect(mermaid.html.toString()).toContain('naturalWidth');
 });
 it('keeps fixed calendar inputs and records unavoidable API differences explicitly',()=>{
  const date=richBrowserParityFixtures.find(f=>f.family==='DatePicker');expect(date.oldJsx).toContain('2024-06-15');expect(date.setup).toContain('2024-06-15');expect(date.oldJsx).toContain('min="2024-06-01"');expect(date.newHtml).toContain('max="2024-06-30"');
  expect(date.limitations.join(' ')).toContain('trigger name');
  const user=richBrowserParityFixtures.find(f=>f.family==='User');expect(user.oldJsx).toContain('userId=""');expect(user.oldJsx).toContain('Unassigned');expect(user.newHtml).toContain('Unassigned');expect(user.limitations.join(' ')).toContain('seeded person-card');
 });
 it('pairs slide navigation through the shared reader rail while retaining focus evidence',()=>{
  const slides=richBrowserParityFixtures.find(f=>f.id==='slides-two');
  expect(slides.states[1]).toMatchObject({id:'details',actions:[{role:'button',name:'Go to slide 2: Details',action:'click'}],expected:{roles:[{role:'button',name:'Go to slide 2: Details',focused:true}],textIncludes:['Details','Second observation.']}});
  expect(slides.limitations.join(' ')).toContain('fullscreen and print remain separate');
 });
});
