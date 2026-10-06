import {expect,it} from 'vitest';
import {parse} from 'yaml';
import {recoverableDraft} from '../editor/recoverable-draft';
it('preserves unsaved title, appearance and exact markup in a portable JSX copy',()=>{
 const source='<article id="doc"><h1 id="title">Synthetic draft</h1></article>';
 const metadata={title:'Unsaved title: café\n---',theme:'drafting',template:'doc',colorMode:'dark'};
 const copied=recoverableDraft(source,metadata);
 const match=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(copied);
 expect(match).not.toBeNull();
 expect(parse(match![1]!)).toEqual(metadata);
 expect(match![2]).toBe(source);
});
it('keeps null metadata explicit without adding remote identity or share grants',()=>{
 const metadata={title:null,theme:null,template:null,colorMode:null};
 const copy=recoverableDraft('<p id="p">retained</p>',metadata);
 const match=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(copy);
 expect(match).not.toBeNull();
 expect(parse(match![1]!)).toEqual(metadata);
 expect(match![2]).toBe('<p id="p">retained</p>');
});
