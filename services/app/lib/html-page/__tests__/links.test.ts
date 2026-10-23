import {expect,it} from 'vitest';
import {htmlPageDeclarations} from '../index';
it('declares live by default and records an explicit pinned dataset revision',()=>{
 expect(htmlPageDeclarations('<link rel="af-dataset" data-af-name="live" href="ref:abc123"><link rel="af-dataset" data-af-name="old" href="ref:def456" data-af-mode="pinned" data-af-revision="2">').datasets).toEqual([{kind:'dataset',name:'live',datasetId:'abc123',mode:'live'},{kind:'dataset',name:'old',datasetId:'def456',mode:'pinned',revision:'2'}]);
});
it('refuses duplicate namespaces across backend and dataset links',()=>{
 expect(()=>htmlPageDeclarations('<link rel="af-backend" data-af-name="db"><link rel="af-dataset" data-af-name="db" href="ref:abc123">')).toThrow('Duplicate');
});
it('refuses fake origins, invalid IDs, modes and pinned revisions',()=>{
 for(const attrs of ['href="https://fake.invalid/ref:abc123"','href="ref:a"','href="ref:abc123" data-af-mode="once"','href="ref:abc123" data-af-mode="pinned"','href="ref:abc123" data-af-mode="pinned" data-af-revision="0"','href="ref:abc123" data-af-mode="pinned" data-af-revision="9007199254740992"','href="ref:abc123" data-af-revision="2"'])expect(()=>htmlPageDeclarations(`<link rel="af-dataset" data-af-name="db" ${attrs}>`)).toThrow();
});
