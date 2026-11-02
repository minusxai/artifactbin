import {afterEach,describe,expect,it,vi} from 'vitest';
import {BASEMAP_PATH} from '@artifactbin/contracts/basemap';
import {BASEMAP_ALLOWED,BASEMAP_UPSTREAM,dailySeries,tileUpstreamUrl} from '..';
import {BASEMAP_WORKER_URL,basemapStyleUrl,basemapTransformRequest} from '../basemap';
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
