import {describe,it,expect} from 'vitest';
import {selectNewArtifactDestination} from '../groups/destination';
const personal={type:'personal'} as const;
const alpha={type:'group',id:'grp_alpha'} as const;
const beta={type:'group',id:'grp_beta'} as const;
describe('new artifact destination contract',()=>{
 it('defaults to Personal only when no group destination applies',()=>{
  expect(selectNewArtifactDestination({})).toEqual(personal);
  expect(selectNewArtifactDestination({preference:{type:'inherit'},deployment_default:alpha})).toEqual(alpha);
 });
 it('honors explicit Personal and account Personal over company defaults',()=>{
  expect(selectNewArtifactDestination({explicit:personal,preference:alpha,deployment_default:beta})).toEqual(personal);
  expect(selectNewArtifactDestination({preference:personal,deployment_default:beta})).toEqual(personal);
 });
 it('uses parent owner before account or deployment defaults',()=>{
  expect(selectNewArtifactDestination({parent:alpha,preference:beta})).toEqual(alpha);
  expect(selectNewArtifactDestination({parent:personal,deployment_default:alpha})).toEqual(personal);
  expect(selectNewArtifactDestination({explicit:alpha,parent:alpha})).toEqual(alpha);
 });
 it('refuses conflicting explicit and parent owners instead of silently choosing either',()=>{
  expect(()=>selectNewArtifactDestination({explicit:alpha,parent:beta})).toThrow(/destination|owner/i);
  expect(()=>selectNewArtifactDestination({explicit:personal,parent:alpha})).toThrow(/destination|owner/i);
 });
 it('retains an explicit saved group selection for authorization; never falls back to Personal',()=>{
  expect(selectNewArtifactDestination({preference:alpha,deployment_default:beta})).toEqual(alpha);
 });
});
