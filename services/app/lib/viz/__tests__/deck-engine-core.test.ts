import {describe,expect,it} from 'vitest';
import {ATTRIBUTION,MAP_CLASSES,basemapStyleOf,boundaryKeyOf,buildLayers,compactNumber,extentOf,fittedView,layerSpecs,legendScales,paletteFor,rgbCss,tooltipRecord} from '../deck-engine-core';
import {ATTRIBUTION as CHROME_ATTRIBUTION,MAP_CLASSES as CHROME_CLASSES} from '../deck-chrome';
const palette=paletteFor(false);
describe('deck engine core',()=>{
 it('ramps from the surface towards the chart blue and reuses the chart palette for categories',()=>{
  expect(palette.sequential).toHaveLength(7);expect(palette.sequential[0]).toEqual([226,236,246]);
  expect(paletteFor(true).sequential[0]).toEqual([30,41,59]);expect(paletteFor(true).sequential[6]).toEqual(palette.sequential[6]);
  expect(palette.categorical.every(c=>c.length===3&&c.every(v=>v>=0&&v<=255))).toBe(true);
 });
 it('keeps only allowlisted layer types and names their boundary sets as one key',()=>{
  const specs=layerSpecs([{'@@type':'ScatterplotLayer'},{'@@type':'TripsLayer'},null,'x',{'@@type':'GeoJsonLayer',data:'boundary:world'}]);
  expect(specs.map(s=>s['@@type'])).toEqual(['ScatterplotLayer','GeoJsonLayer']);
  expect(layerSpecs('nope')).toEqual([]);
  expect(boundaryKeyOf(specs)).toBe('world');
 });
 it('builds layers over rows, joined boundaries and GeoJSON rows; drops unsafe accessors and missing boundaries',()=>{
  const rows=[{lng:10,lat:20,name:'a',n:3},{lng:30,lat:-10,name:'b',n:9}];
  const built=buildLayers([
   {'@@type':'ScatterplotLayer',getPosition:'@@=[lng, lat]',getFillColor:'@@=ramp(n)',radiusMinPixels:3},
   {'@@type':'ScatterplotLayer',getPosition:'@@raw'},
   {'@@type':'GeoJsonLayer',data:'boundary:world','@@join':['NAME','name']},
   {'@@type':'GeoJsonLayer',data:'boundary:missing'},
  ],rows,{world:[{type:'Feature',properties:{NAME:'a'},geometry:{type:'Point',coordinates:[1,2]}}]},palette);
  expect(built).toHaveLength(2);
  expect(built[0]!.accessors.getPosition).toBeTypeOf('function');
  expect((built[1]!.data[0] as {properties:Record<string,unknown>}).properties).toMatchObject({NAME:'a',n:3});
  expect(extentOf(built)).toEqual([[1,-10],[30,20]]);
  expect(legendScales(built,palette).map(s=>s.kind)).toEqual(['ramp']);
  const geo=buildLayers([{'@@type':'GeoJsonLayer'}],[{geometry:'{"type":"Point","coordinates":[5,6]}',k:1},{geometry:'not json'},{geometry:null}],{},palette);
  expect(geo[0]!.data).toEqual([{type:'Feature',properties:{k:1},geometry:{type:'Point',coordinates:[5,6]}}]);
 });
 it('fits the view to the data, respects an authored view, and falls back to the world',()=>{
  expect(fittedView({zoom:3},null,0,0)).toMatchObject({zoom:3,latitude:20,longitude:0});
  expect(fittedView(undefined,null,400,300)).toEqual({longitude:0,latitude:20,zoom:1,pitch:0,bearing:0});
  const view=fittedView(undefined,[[-1,-1],[1,1]],400,300);
  expect(view.longitude).toBeCloseTo(0,5);expect(view.zoom).toBeGreaterThan(1);
  expect(fittedView(undefined,[[2,2],[2,2]],400,300).zoom).toBe(14);
  expect(extentOf([])).toBeNull();
 });
 it('shows a feature’s properties, a bin’s count or the row, without geometry, nulls or empties',()=>{
  expect(tooltipRecord({properties:{name:'a',x:null}},null)).toEqual({name:'a'});
  expect(tooltipRecord({count:4,position:[0,0],colorValue:2},null)).toEqual({count:4,value:2});
  expect(tooltipRecord({count:4,position:[0,0],colorValue:4},null)).toEqual({count:4});
  expect(tooltipRecord({a:1,b:2,position:[0,0]},['b'])).toEqual({b:2});
  for(const value of [null,'x',{},{a:null}])expect(tooltipRecord(value,null)).toBeNull();
 });
 it('follows the document mode only for an automatic basemap and formats the legend',()=>{
  expect(basemapStyleOf('none','dark')).toBeNull();expect(basemapStyleOf('light','dark')).toBe('light');expect(basemapStyleOf('dark','light')).toBe('dark');expect(basemapStyleOf('auto','dark')).toBe('dark');
  expect(rgbCss([1,2,3])).toBe('rgb(1, 2, 3)');expect(compactNumber.format(1234)).toMatch(/1\.2\s?K/i);
  expect(ATTRIBUTION).toBe(CHROME_ATTRIBUTION);expect(MAP_CLASSES).toBe(CHROME_CLASSES);
 });
});
