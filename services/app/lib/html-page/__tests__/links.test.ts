import {describe,expect,it} from 'vitest';
import {htmlPageDeclarations,resolveDatasetApis} from '../index';
it('declares live by default and records an explicit pinned dataset revision',()=>{
 expect(htmlPageDeclarations('<link rel="af-dataset" data-af-name="live" href="ref:abc123"><link rel="af-dataset" data-af-name="old" href="ref:def456" data-af-mode="pinned" data-af-revision="2">').datasets).toEqual([{kind:'dataset',name:'live',datasetId:'abc123',mode:'live'},{kind:'dataset',name:'old',datasetId:'def456',mode:'pinned',revision:'2'}]);
});
it('refuses duplicate namespaces across backend and dataset links',()=>{
 expect(()=>htmlPageDeclarations('<link rel="af-resolver" data-af-name="db"><link rel="af-dataset" data-af-name="db" href="ref:abc123">')).toThrow('Duplicate');
});
it('refuses fake origins, invalid IDs, modes and pinned revisions',()=>{
 for(const attrs of ['href="https://fake.invalid/ref:abc123"','href="ref:a"','href="ref:abc123" data-af-mode="once"','href="ref:abc123" data-af-mode="pinned"','href="ref:abc123" data-af-mode="pinned" data-af-revision="0"','href="ref:abc123" data-af-mode="pinned" data-af-revision="9007199254740992"','href="ref:abc123" data-af-revision="2"'])expect(()=>htmlPageDeclarations(`<link rel="af-dataset" data-af-name="db" ${attrs}>`)).toThrow();
});
it('declares resolvers with af-resolver only: the removed af-backend rel declares nothing',()=>{
 expect(htmlPageDeclarations('<link rel="af-resolver" data-af-name="budget" href="./budget.ts"><link rel="af-resolver" data-af-name="garden" href="./garden.ts">').backends).toEqual(['budget','garden']);
 expect(htmlPageDeclarations('<link rel="af-backend" data-af-name="garden" href="./garden.ts">').backends).toEqual([]);
});
it('refuses one resolver name declared twice, or one link declaring two kinds',()=>{
 expect(()=>htmlPageDeclarations('<link rel="af-resolver" data-af-name="db"><link rel="af-resolver" data-af-name="db">')).toThrow('Duplicate');
 expect(()=>htmlPageDeclarations('<link rel="af-resolver af-dataset" data-af-name="db" href="ref:abc123">')).toThrow('A link declares one namespace kind');
});

describe('the dataset API a new link mounts', () => {
  const page = (script: string, api = '') => `<!doctype html><html><head><link rel="af-dataset" data-af-name="items" href="ref:abcdef"${api}></head><body><script type="module">${script}</script></body></html>`;
  const apiOf = (html: string) => resolveDatasetApis(htmlPageDeclarations(html).datasets)[0]!.api;
  it('keeps pages written against the legacy dataset API on it, so older installed skills keep working', () => {
    expect(apiOf(page('const q=gql`{items{schema{revision tables{id label}}}}`;'))).toBe('legacy');
    expect(apiOf(page('const D="items";q(`query($t:ID!){${D}{rows(tableId:$t,first:100){rows{id}}}}`)'))).toBe('legacy');
    expect(apiOf(page('m(`mutation{items{writeRows(tableId:"t",expectedRevision:"1",requestId:"r",changes:[]){outcome}}}`)'))).toBe('legacy');
  });
  it('gives the generated API to new links that use it or no dataset query at all, and an explicit choice always wins', () => {
    expect(apiOf(page('const q=gql`{items(where:{qty:{_gt:1}}){item qty}}`;'))).toBe('hasura');
    expect(apiOf(page(''))).toBe('hasura');
    expect(apiOf(page('const q=gql`{items{schema{revision}}}`;', ' data-af-api="hasura"'))).toBe('hasura');
  });
});
