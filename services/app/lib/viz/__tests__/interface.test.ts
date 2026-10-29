import {afterEach,describe,expect,it,vi} from 'vitest';
import {BASEMAP_PATH} from '@artifactbin/contracts/basemap';
import {BASEMAP_ALLOWED,BASEMAP_UPSTREAM,dailySeries,renderSparklineSvg,tileUpstreamUrl} from '..';
import {BASEMAP_WORKER_URL,basemapStyleUrl,basemapTransformRequest} from '../basemap';
import {deckGlHeight} from '../deck-height';
import {ATTRIBUTION,MAP_CLASSES} from '../deck-chrome';
import {inferVizColumnsFromRows} from '../query-data';
import {beginChartRender,trackChartRender} from '../render-readiness';
import {chartTokenRangeFromElement} from '../chart-tokens';
afterEach(()=>vi.unstubAllGlobals());

describe('basemap proxy',()=>{
 const allowed=(path:string)=>BASEMAP_ALLOWED.some(rule=>rule.test(path));
 it('forwards only the OpenFreeMap styles, tiles, glyphs and sprites a map uses',()=>{
  expect(BASEMAP_UPSTREAM).toBe('https://tiles.openfreemap.org');
  for(const path of ['styles/positron','styles/dark','planet','planet/20250101_001001_pt/14/8192/5461.pbf','fonts/Noto Sans Regular,Noto Sans Bold/0-255.pbf','sprites/ofm_f384/ofm@2x.png','sprites/ofm_f384/ofm.json','natural_earth/ne2sr/3/4/2.png'])expect(allowed(path)).toBe(true);
  for(const path of ['styles/liberty','planet/x/123/1/1.pbf','../etc/passwd','planet/a/1/1/1.pbf?x=1','fonts/a/0-255.json','sprites/other/ofm.png','','https://evil.example/planet'])expect(allowed(path)).toBe(false);
 });
 it('names the style and rewrites only upstream URLs onto the same-origin proxy',()=>{
  vi.stubGlobal('location',{origin:'https://doc.pages.test'});
  expect(basemapStyleUrl('light')).toBe(`https://doc.pages.test${BASEMAP_PATH}styles/positron`);
  expect(basemapStyleUrl('dark')).toBe(`https://doc.pages.test${BASEMAP_PATH}styles/dark`);
  expect(basemapTransformRequest(`${BASEMAP_UPSTREAM}/planet/v/1/2/3.pbf`)).toEqual({url:`https://doc.pages.test${BASEMAP_PATH}planet/v/1/2/3.pbf`});
  // A look-alike host or the bare origin is not an upstream path.
  for(const url of [`${BASEMAP_UPSTREAM}.evil.example/planet`,BASEMAP_UPSTREAM,'https://doc.pages.test/x'])expect(basemapTransformRequest(url)).toEqual({url});
  expect(BASEMAP_WORKER_URL).toBe(`${BASEMAP_PATH}worker.mjs`);
 });
});

it('maps only allowlisted Carto tile paths, refusing everything else',()=>{
 expect(tileUpstreamUrl(['light_all','3','4','5@2x.png'])).toBe('https://basemaps.cartocdn.com/light_all/3/4/5@2x.png');
 for(const segments of [['light_all','3','4'],['voyager','3','4','5.png'],['dark_all','123','4','5.png'],['dark_all','3','4','5.jpg'],['dark_all','3','x','5.png'],['dark_all','3','4','12345678.png'],['dark_all','3','4','5.png','extra']])expect(tileUpstreamUrl(segments)).toBeNull();
});

describe('dailySeries',()=>{
 const now=new Date('2026-10-29T18:30:00Z');
 it('buckets UTC days oldest first, per artifact, ignoring rows outside the window',()=>{
  const series=dailySeries([{artifact_id:'a',day:'2026-10-29',n:5},{artifact_id:'a',day:'2026-10-27',n:2},{artifact_id:'b',day:'2026-10-28',n:1},{artifact_id:'a',day:'2026-10-26',n:9},{artifact_id:'c',day:'2026-10-30',n:4}],3,now);
  expect([...series]).toEqual([['a',[2,0,5]],['b',[0,1,0]]]);
 });
 it('returns no series for no rows or an empty window',()=>{
  expect(dailySeries([],7,now).size).toBe(0);
  expect(dailySeries([{artifact_id:'a',day:'2026-10-29',n:1}],0,now).size).toBe(0);
 });
});

it('renders a fixed-size sparkline as standalone SVG (plus its 1px padding), empty series included',async()=>{
 const svg=await renderSparklineSvg([0,3,1,4],{width:60,height:12});
 expect(svg).toMatch(/^<svg[^>]*width="62" height="14"/);
 expect(svg).toContain('#3fe77b');
 expect(await renderSparklineSvg([])).toMatch(/^<svg[^>]*width="98" height="22"/);
});

it('holds the authored DeckGL height, defaulting to 420 for anything unparseable',()=>{
 expect(deckGlHeight(300)).toBe(300);expect(deckGlHeight('250px')).toBe(250);
 for(const value of [undefined,null,'tall','',{}])expect(deckGlHeight(value)).toBe(420);
 expect(MAP_CLASSES.figure).toContain('relative');expect(ATTRIBUTION).toContain('OpenStreetMap');
});

it('infers each column kind from its first non-null value',()=>{
 expect(inferVizColumnsFromRows([])).toEqual([]);
 expect(inferVizColumnsFromRows([{n:null,d:'2024-01-01',t:'2024-01-01T00:00:00.000Z',s:'x',b:true,i:Infinity,o:{},w:new Date(0)},{n:4}])).toEqual([
  {name:'n',kind:'quantitative'},{name:'d',kind:'temporal'},{name:'t',kind:'temporal'},{name:'s',kind:'nominal'},{name:'b',kind:'boolean'},{name:'i',kind:'unknown'},{name:'o',kind:'unknown'},{name:'w',kind:'temporal'},
 ]);
 expect(inferVizColumnsFromRows([{x:null},{x:null}])).toEqual([{name:'x',kind:'unknown'}]);
});

describe('chart render readiness',()=>{
 const element=()=>({dataset:{}} as unknown as HTMLElement);
 it('stays pending until every overlapping render settles, even when one throws',async()=>{
  const chart=element();let release!:()=>void;
  const slow=trackChartRender(chart,()=>new Promise<string>(r=>{release=()=>r('done');}));
  expect(chart.dataset.mxChartState).toBe('pending');
  await expect(trackChartRender(chart,async()=>{throw Error('build failed');})).rejects.toThrow('build failed');
  expect(chart.dataset.mxChartState).toBe('pending');
  release();expect(await slow).toBe('done');expect(chart.dataset.mxChartState).toBe('ready');
 });
 it('counts a finish once however often it is called',()=>{
  const chart=element(),a=beginChartRender(chart),b=beginChartRender(chart);
  a();a();expect(chart.dataset.mxChartState).toBe('pending');b();expect(chart.dataset.mxChartState).toBe('ready');
 });
});

it('reads chart tokens from an element in its own document view, null without one',()=>{
 const tokens:Record<string,string>={'--chart-1':'#111111','--chart-2':' #222222 ','--chart-3':''};
 const el={ownerDocument:{defaultView:{getComputedStyle:()=>({getPropertyValue:(name:string)=>tokens[name]??''})}}} as unknown as Element;
 expect(chartTokenRangeFromElement(el)).toEqual(['#111111','#222222']);
 expect(chartTokenRangeFromElement({ownerDocument:{defaultView:null}} as unknown as Element)).toBeNull();
 tokens['--chart-1']='';expect(chartTokenRangeFromElement(el)).toBeNull();
});
