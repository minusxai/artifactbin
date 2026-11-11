/**
 * The boundary files the skill's maps reference names (`/af/geojson/<file>.json`) exist under public/geojson, as GeoJSON
 * FeatureCollections whose every feature carries what the reference says it carries, so the reference cannot drift
 * from the files the platform serves.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const reference=readFileSync(path.resolve('skills/artifactbin/references/maps.md'),'utf8');
/** What maps.md claims of each file: its feature properties and what its feature `id` is. */
const CLAIMS:Record<string,{properties:Record<string,RegExp>;id?:RegExp;count?:number}>={
 'india-states.json':{properties:{name:/\S/,code:/^IN-[A-Z]{2}$/,postal:/^[A-Z]{2}$/},count:36},
 'us-states.json':{properties:{name:/\S/},id:/^\d{2}$/},
 'world.json':{properties:{name:/\S/},id:/^(?:[A-Z]{3}|-99|CS-KM)$/},
};

it('names exactly the boundary files it describes, and the loading line',()=>{
 const named=new Set([...reference.matchAll(/`([a-z0-9-]+\.json)`/g)].map(match=>match[1]));
 expect([...named].sort()).toEqual(Object.keys(CLAIMS).sort());
 expect(reference).toContain('fetch("/af/geojson/india-states.json")');
 for(const [file,claim] of Object.entries(CLAIMS)){
  // Each file's own description: from "`file`:" to the next file's, or the paragraph's end.
  const sentence=reference.split(/(?=`[a-z0-9-]+\.json`:)|\n/).find(part=>part.startsWith('`'+file+'`:'))!;
  expect(sentence,file).toBeTruthy();
  for(const property of Object.keys(claim.properties))expect(sentence,file).toContain(property+'`');
  if(claim.id)expect(sentence,file).toContain('feature `id`');
 }
});

it.each(Object.entries(CLAIMS))('%s is a FeatureCollection whose every feature carries what the reference says',(file,claim)=>{
 const json=JSON.parse(readFileSync(path.resolve('public/geojson',file),'utf8')) as {type:string;features:Array<{id?:unknown;properties:Record<string,unknown>;geometry:unknown}>};
 expect(json.type).toBe('FeatureCollection');
 if(claim.count)expect(json.features).toHaveLength(claim.count);
 for(const feature of json.features){
  expect(feature.geometry).toBeTruthy();
  for(const [property,pattern] of Object.entries(claim.properties))expect(String(feature.properties[property]??''),`${file} ${property}`).toMatch(pattern);
  if(claim.id)expect(String(feature.id??''),`${file} id`).toMatch(claim.id);
 }
});
