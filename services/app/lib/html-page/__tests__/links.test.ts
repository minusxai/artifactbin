import {expect,it} from 'vitest';
import {htmlPageDeclarations} from '../index';
it('declares live by default and records an explicit pinned dataset revision',()=>{
 expect(htmlPageDeclarations('<link rel="af-dataset" data-af-name="live" href="ref:abc123"><link rel="af-dataset" data-af-name="old" href="ref:def456" data-af-mode="pinned" data-af-revision="2">').datasets).toEqual([{kind:'dataset',name:'live',datasetId:'abc123',mode:'live'},{kind:'dataset',name:'old',datasetId:'def456',mode:'pinned',revision:'2'}]);
});
it('refuses one dataset name declared twice',()=>{
 expect(()=>htmlPageDeclarations('<link rel="af-dataset" data-af-name="db" href="ref:abc123"><link rel="af-dataset" data-af-name="db" href="ref:def456">')).toThrow('Duplicate');
});
it('refuses fake origins, invalid IDs, modes and pinned revisions',()=>{
 for(const attrs of ['href="https://fake.invalid/ref:abc123"','href="ref:a"','href="ref:abc123" data-af-mode="once"','href="ref:abc123" data-af-mode="pinned"','href="ref:abc123" data-af-mode="pinned" data-af-revision="0"','href="ref:abc123" data-af-mode="pinned" data-af-revision="9007199254740992"','href="ref:abc123" data-af-revision="2"'])expect(()=>htmlPageDeclarations(`<link rel="af-dataset" data-af-name="db" ${attrs}>`)).toThrow();
});
it('declares datasets only: a page-function link (af-resolver, af-backend) declares nothing',()=>{
 expect(htmlPageDeclarations('<link rel="af-resolver" data-af-name="budget" href="./budget.ts"><link rel="af-backend" data-af-name="garden" href="./garden.ts">')).toEqual({datasets:[],connections:[],queries:[]});
});

it('stores a dataset link as its name, dataset and mode only, whatever the page queries or the link carries', () => {
  const page = (script: string, attrs = '') => `<!doctype html><html><head><link rel="af-dataset" data-af-name="items" href="ref:abcdef"${attrs}></head><body><script type="module">${script}</script></body></html>`;
  const link = { kind: 'dataset', name: 'items', datasetId: 'abcdef', mode: 'live' };
  // Every link mounts the generated API: no per-link choice, no detection from the page's queries.
  expect(htmlPageDeclarations(page('const q=gql`{items{schema{revision tables{id label}}}}`;')).datasets).toEqual([link]);
  expect(htmlPageDeclarations(page('const q=gql`{items(where:{qty:{_gt:1}}){item qty}}`;', ' data-af-api="legacy"')).datasets).toEqual([link]);
  expect(htmlPageDeclarations(page('', ' data-af-api="hasura"')).datasets).toEqual([link]);
});

test('a default: link stores the default-connection shape: its page name and the database after the colon', () => {
 expect(htmlPageDeclarations('<link rel="af-dataset" data-af-name="wh" href="default:warehouse/finance"><link rel="af-dataset" data-af-name="raw" href="default:">').connections)
  .toEqual([{ kind: 'default-connection', name: 'wh', namespace: 'warehouse/finance' }, { kind: 'default-connection', name: 'raw', namespace: '' }]);
});

it('declares queries: a named application/sql script on a named link, its text as written, nothing else', () => {
 const q=(attrs:string,text='select 1')=>htmlPageDeclarations(`<head><script type="application/sql" ${attrs}>${text}</script></head>`);
 expect(q('data-af-query="mine" data-af-dataset="shop"',' select id from sales.orders where owner = :viewer_email ').queries).toEqual([{name:'mine',link:'shop',sql:'select id from sales.orders where owner = :viewer_email'}]);
 // A plain SQL script (no data-af-query) is page content, not a declaration.
 expect(q('data-af-dataset="shop"').queries).toEqual([]);
 for(const bad of ['data-af-query="a b" data-af-dataset="shop"','data-af-query="mine"','data-af-query="mine" data-af-dataset="shop" src="./q.sql"'])expect(()=>q(bad),bad).toThrow();
 expect(()=>q('data-af-query="mine" data-af-dataset="shop"',' ')).toThrow();
 expect(()=>htmlPageDeclarations('<script type="application/sql" data-af-query="a" data-af-dataset="s">x</script><script type="application/sql" data-af-query="a" data-af-dataset="s">y</script>')).toThrow(/Two declared queries/);
});
