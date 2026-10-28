import {expect,it} from 'vitest';
import {transformSync} from 'esbuild';
import {JSDOM} from 'jsdom';
import {richFamilies,richViewports,richFixtureHtml} from '../lib/html-rich-components-fixture.mjs';
it('covers all six public shipped-module contracts with unique authored identities in both exact themes',()=>{
 expect(richFamilies.map(([name])=>name)).toEqual(['DataTable','Markdown','Mermaid','Isometric','DeckGL','User']);
 expect(richViewports.map(view=>view.width)).toEqual([800,390]);
 for(const dark of [false,true]){
  const html=richFixtureHtml(dark),doc=new JSDOM(html).window.document;
  expect(()=>transformSync(doc.querySelector('script[type=module]').textContent,{loader:'js',format:'esm'})).not.toThrow();
  expect(doc.documentElement.getAttribute('data-af-dark')).toBe(String(dark));
  const identities=[...doc.querySelectorAll('[data-af-id]')].map(node=>node.getAttribute('data-af-id'));expect(new Set(identities).size).toBe(12);
  for(const [,file,id] of richFamilies){expect(doc.querySelector('#'+id)?.getAttribute('data-af-id')).toBe('host-'+id);expect(doc.querySelector('#'+id)?.localName).toBe('af-'+file);expect(html).toContain(`import '/components/${file}.js';`);}
  expect(html).not.toMatch(/\bregister[A-Z]/);expect(html).toContain("basemap:'none'");expect(html).not.toMatch(/https?:\/\//);expect(html).not.toContain('mock');
 }
});
it('distinguishes retained authored identities from changing generated identities',async()=>{
 const {richIdentityFacts}=await import('../lib/html-rich-components-fixture.mjs');
 const doc=new JSDOM('<main data-af-id="host-table"><aside data-af-id="note-table"></aside><span data-af-id="generated-cell-1"></span></main>').window.document;
 const authored=[...doc.querySelectorAll('[data-af-id^="host-"],[data-af-id^="note-"]')].map(node=>({node,id:node.getAttribute('data-af-id')}));
 doc.querySelector('span').replaceWith(doc.createElement('input'));doc.querySelector('input').setAttribute('data-af-id','generated-cell-2');
 expect(richIdentityFacts(authored,doc)).toEqual({retained:true,unique:true});
 doc.querySelector('input').setAttribute('data-af-id','note-table');expect(richIdentityFacts(authored,doc)).toEqual({retained:true,unique:false});
 doc.querySelector('aside').setAttribute('data-af-id','changed-note');expect(richIdentityFacts(authored,doc).retained).toBe(false);
});
