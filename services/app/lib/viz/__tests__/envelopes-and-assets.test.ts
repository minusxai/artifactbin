import {afterEach,describe,expect,it,vi} from 'vitest';
import {questionEnvelope} from '../chart-envelope';
import {annotationSplit,isBlankSpec,zonesForVizType} from '../encoding-edit';
import {GEO_BOUNDARY_DATASET,loadGeoFeatures,resolveGeoAsset} from '../geo-assets';
import {injectNamedAssets,resizeVegaView,resolveEnvelopeSpec} from '../render-vega';
import type {VizEnvelope} from '@/lib/validation';
afterEach(()=>vi.unstubAllGlobals());

describe('questionEnvelope',()=>{
 const columns=[{name:'a',type:'number'}] as never;
 it('wraps native specs and inline recipes in a version 2 envelope with no bindings or assets',()=>{
  expect(questionEnvelope({kind:'vega-lite',spec:{mark:'bar'}},columns)).toEqual({version:2,source:{kind:'vega-lite',grammar:'vega-lite@6',spec:{mark:'bar'}},dataBindings:null,viewParams:null,interactions:null,assets:null});
  expect(questionEnvelope({kind:'vega',spec:[1]},columns)).toMatchObject({source:{kind:'vega',grammar:'vega@6',spec:{}}});
  expect(questionEnvelope({kind:'recipe',recipe:'minusx/funnel@1',bindings:{stage:'s'}},columns)).toMatchObject({source:{kind:'recipe',recipe:'minusx/funnel@1',bindings:{stage:'s'},params:null,columnFormats:null}});
 });
 it('materializes a referenced recipe file, and refuses a missing or broken one',()=>{
  const recipe={description:'bars',engine:'vega-lite',bindings:[{name:'x'}],template:{mark:'bar',encoding:{x:{field:'{{x}}',type:'{{x:kind}}'}}}};
  expect(questionEnvelope({kind:'recipe',recipe:'ref:r1',bindings:{x:'a'}},columns,{r1:{kind:'viz',recipe}} as never)).toMatchObject({source:{kind:'vega-lite',spec:{mark:'bar',encoding:{x:{field:'a',type:'quantitative'}}}}});
  expect(questionEnvelope({kind:'recipe',recipe:'ref:r1',bindings:{x:'a'}},columns,{r1:{kind:'viz',recipe:{...recipe,engine:'vega'}}} as never)).toMatchObject({source:{kind:'vega',grammar:'vega@6'}});
  expect(questionEnvelope({kind:'recipe',recipe:'ref:gone'},columns,{})).toEqual({error:'recipe unavailable — falling back'});
  expect(questionEnvelope({kind:'recipe',recipe:'ref:r1',bindings:{}},columns,{r1:{kind:'viz',recipe}} as never)).toEqual({error:'recipe error: missing binding: x'});
  expect(questionEnvelope({kind:'table'},columns)).toEqual({error:'unknown viz kind "table"'});
 });
});

describe('encoding edit helpers',()=>{
 it('calls a spec blank only without a mark, an encoded channel or a composition',()=>{
  expect(isBlankSpec({})).toBe(true);expect(isBlankSpec({encoding:{}})).toBe(true);
  for(const spec of [{mark:'bar'},{encoding:{x:{field:'a'}}},{layer:[]},{hconcat:[]},{facet:{}}])expect(isBlankSpec(spec)).toBe(false);
 });
 it('splits an annotated unit into its base chart and datum-only rule/rect/text layers',()=>{
  const unit={mark:'line',encoding:{x:{field:'d'},y:{field:'n'}}};
  expect(annotationSplit(unit)).toEqual({unit,annotations:[]});
  const rule={mark:'rule',encoding:{y:{datum:10}}},label={mark:{type:'text'},encoding:{y:{datum:10},text:{value:'goal'}}};
  expect(annotationSplit({layer:[unit,rule,label]})).toEqual({unit,annotations:[rule,label]});
  // A field-encoded or non-annotation layer keeps the spec custom; so does any other composition or a lone layer.
  for(const spec of [{layer:[unit,{mark:'rule',encoding:{y:{field:'n'}}}]},{layer:[unit,{mark:'bar',encoding:{y:{datum:1}}}]},{layer:[unit,{mark:'rule'}]},{layer:[unit,{mark:'rule',encoding:{y:null}}]},{layer:[unit]},{layer:[unit,rule],hconcat:[]}])expect(annotationSplit(spec)).toBeNull();
 });
 it('offers each viz type only the drop zones it draws',()=>{
  expect(zonesForVizType('pie').map(z=>z.channel)).toEqual(['color','theta']);
  expect(zonesForVizType('heatmap').map(z=>z.label)).toEqual(['X-Axis','Y-Axis','Value']);
  expect(zonesForVizType('histogram').map(z=>z.channel)).toEqual(['x','color']);
  expect(zonesForVizType(null)).toEqual(zonesForVizType('bar'));
  expect(zonesForVizType('bar').map(z=>z.channel)).toEqual(['x','y','color']);
 });
});

describe('geo boundaries',()=>{
 it('resolves only allowlisted ids, defaulting to US states',()=>{
  expect(resolveGeoAsset('world')).toBe('world');
  for(const id of ['nowhere',undefined,42,''])expect(resolveGeoAsset(id)).toBe('us-states');
  expect(GEO_BOUNDARY_DATASET).toBe('__mx_geo_boundary');
 });
 // BUG: isGeoAsset uses `id in GEO_ASSETS`, which also sees Object.prototype keys, so an authored
 // mapName of "__proto__" or "toString" resolves to itself (and boundaryFile/loadGeoFeatures read a
 // file named "undefined") instead of falling back to the default boundary set.
 it.fails('never resolves an inherited object key as a boundary asset',()=>{
  for(const id of ['__proto__','toString','constructor'])expect(resolveGeoAsset(id)).toBe('us-states');
 });
 it('loads a boundary once from its public file and refuses unknown ids and failed loads',async()=>{
  const features=[{type:'Feature',properties:{name:'Goa'},geometry:null}];
  const fetch=vi.fn(async()=>Response.json({type:'FeatureCollection',features}));vi.stubGlobal('fetch',fetch);
  await expect(loadGeoFeatures('atlantis')).rejects.toThrow('unknown geo boundary "atlantis"');
  expect(await loadGeoFeatures('india-states')).toEqual(features);
  expect(await loadGeoFeatures('india-states')).toEqual(features);
  expect(fetch).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledWith('/geojson/india-states.json');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('missing',{status:404})));
  await expect(loadGeoFeatures('world')).rejects.toThrow('Failed to load boundary asset /geojson/world-atlas-countries-110m.json');
 });
});

describe('render pipeline seams',()=>{
 const envelope=(source:Record<string,unknown>)=>({version:2,source,dataBindings:null,viewParams:null,interactions:null,assets:null}) as unknown as VizEnvelope;
 it('resolves native, detached, shipped and workspace recipe sources to one renderable spec',()=>{
  expect(resolveEnvelopeSpec(envelope({kind:'vega-lite',spec:{mark:'bar'}}))).toEqual({ok:true,spec:{mark:'bar'},engine:'vega-lite'});
  expect(resolveEnvelopeSpec(envelope({kind:'vega',spec:{marks:[]},assets:{states:'us-states'}}))).toEqual({ok:true,spec:{marks:[]},engine:'vega',assets:{states:'us-states'}});
  expect(resolveEnvelopeSpec(envelope({kind:'vega',spec:{marks:[]},assets:{}}))).toEqual({ok:true,spec:{marks:[]},engine:'vega'});
  expect(resolveEnvelopeSpec(envelope({kind:'recipe',recipe:'team/bars',spec:{marks:[]},grammar:'vega@6'}))).toEqual({ok:true,spec:{marks:[]},engine:'vega'});
  expect(resolveEnvelopeSpec(envelope({kind:'recipe',recipe:'team/bars',spec:{mark:'bar'}}))).toMatchObject({engine:'vega-lite'});
  expect(resolveEnvelopeSpec(envelope({kind:'recipe',recipe:'team/bars',unresolved:'deleted'}))).toEqual({ok:false,error:'viz recipe "team/bars" is not resolved (deleted)'});
  expect(resolveEnvelopeSpec(envelope({kind:'recipe',recipe:'minusx/funnel@1',bindings:{stage:'s',value:'v'}}))).toMatchObject({ok:true,engine:'vega-lite'});
  expect(resolveEnvelopeSpec(envelope({kind:'recipe',recipe:'minusx/nope@1',bindings:{}}))).toMatchObject({ok:false});
 });
 it('binds every named asset as cloned features beside main, and nothing without assets',async()=>{
  const shared={type:'Feature',properties:{name:'A'},geometry:null} as never;
  const bound:Record<string,unknown[]>={},view={data:(name:string,rows:unknown[])=>{bound[name]=rows;}} as never;
  const load=vi.fn(async()=>[shared]);
  await injectNamedAssets(view,undefined,load);expect(load).not.toHaveBeenCalled();
  await injectNamedAssets(view,{states:'us-states',world:'world'},load);
  expect(Object.keys(bound).sort()).toEqual(['states','world']);
  expect(bound.states).toEqual([shared]);expect(bound.states![0]).not.toBe(shared);
  await expect(injectNamedAssets(view,{bad:'x'},async()=>{throw Error('unknown geo boundary');})).rejects.toThrow('unknown geo boundary');
 });
 it('sizes a unit view by its root and a facet by its child signals only',()=>{
  const calls:unknown[][]=[];const signals=new Set(['child_width']);
  const view={width:(w:number)=>calls.push(['width',w]),height:(h:number)=>calls.push(['height',h]),signal:(name:string,value:number)=>{if(!signals.has(name))throw Error(`Unrecognized signal name: ${name}`);calls.push([name,value]);return view;}} as never;
  expect(resizeVegaView(view,{width:300,height:200})).toBe(view);
  expect(calls).toEqual([['width',300],['height',200]]);calls.length=0;
  resizeVegaView(view,{width:300});expect(calls).toEqual([['width',300]]);calls.length=0;
  // A compiled view without one of the child signals keeps that dimension; it never throws or falls back to the root.
  expect(resizeVegaView(view,{width:300,height:200,facetLayout:{childWidth:120,childHeight:80} as never})).toBe(view);
  expect(calls).toEqual([['child_width',120]]);calls.length=0;
  resizeVegaView(view,{facetLayout:{childWidth:null,childHeight:null} as never});expect(calls).toEqual([]);
 });
});
