import {describe,expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import {transformSync} from 'esbuild';
import {parseJsx} from '../../../../services/app/lib/jsx/parse';
import {validateJsx} from '../../../../services/app/lib/jsx/validate';
import {JSX_STORY_COMPONENT_NAMES} from '../../../../services/app/lib/jsx/components';
import {STORY_HTML_TAGS} from '../../../../services/app/lib/jsx/component-names';
import {richBaselineRevision,richBrowserParityFixtures,richBaselineReadiness} from '../rich.mjs';
import {htmlBodyPadding} from '../publication.mjs';
import {stateExpectationIssues} from '../../../lib/component-browser-baseline.mjs';
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
 it('publishes the native Icon paragraph inside the same bare-story typography root as the source reader',()=>{
  const icon=richBrowserParityFixtures.find(fixture=>fixture.id==='icon-glyphs');
  const document=new JSDOM(icon.newHtml).window.document;
  const story=document.querySelector('[data-mx-story-root][data-mx-inline-story]:not([data-mx-styled])');
  expect(story).not.toBeNull();
  expect(story.querySelector(':scope > .mx-doc > p')?.textContent).toContain('Completed');
  expect(story.querySelector('p')?.className).toBe('');
  expect(htmlBodyPadding(icon)).toBe('24px');
 });
 it('pairs slide navigation through the shared pager and records rail viewport applicability',()=>{
  const slides=richBrowserParityFixtures.find(f=>f.id==='slides-two');
  expect(slides.bareRoot).toBe(true);
  const document=new JSDOM(slides.newHtml).window.document;
  const column=document.querySelector('af-slide-deck > div');
  expect(column).not.toBeNull();
  expect(column.style.padding).toBe('24px');
  expect(column.style.gridColumn).toBe('-2 / -1');
  expect(column.querySelectorAll('af-slide')).toHaveLength(2);
  expect(htmlBodyPadding(slides)).toBe('0px');
  expect(htmlBodyPadding({})).toBe('24px');
  expect(slides.states[0].expected.roles).toContainEqual({role:'button',name:'Next slide',disabled:false});
  expect(slides.states[1]).toMatchObject({id:'details',actions:[{role:'button',name:'Next slide',action:'click'}],expected:{roles:[{role:'button',name:'Next slide',focused:true}],textIncludes:['Details','Second observation.','2 / 2']}});
  expect(stateExpectationIssues(slides.states[0].expected,{text:'Overview First observation. Details Second observation. 1 / 2 Next slide',controls:[{role:'button',name:'Next slide',disabled:false}],rows:[],overflow:0})).toEqual([]);
  expect(stateExpectationIssues(slides.states[1].expected,{text:'Details Second observation. 2 / 2',controls:[{role:'button',name:'Next slide',focused:true}],rows:[],overflow:0})).toEqual([]);
  expect(stateExpectationIssues(slides.states[1].expected,{text:'Details Second observation. 2 / 2',controls:[],rows:[],overflow:0})).not.toEqual([]);
  expect(slides.viewportApplicability).toEqual({pager:'shared at desktop and mobile',thumbnailRail:'desktop-only; mobile rail action is not applicable because both readers hide it at widths up to 720px'});
  expect(slides.limitations.join(' ')).toContain('Fullscreen and print remain separate');
  expect(slides.limitations.join(' ')).toContain('reader owns the outer rail gutter');
 });
});
