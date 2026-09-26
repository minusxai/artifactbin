import {expect,it} from 'vitest';
import {parseJsx} from '../../jsx/parse';
import {graphSelectors} from '../document-graph-selectors';
const selectors=(source:string)=>{const parsed=parseJsx(source);if(!parsed.ok)throw new Error(parsed.error);return graphSelectors(parsed.nodes[0]!);};
it('indexes only the own node, keeping independent descendants separate',()=>{
 expect(selectors('<section id="parent"><p id="child">Text</p></section>')).toEqual(['id:parent','tag:section']);
});
it('indexes binding and reactive dependencies using the existing reference collector',()=>{
 expect(selectors('<DataTable id="table" data="$rows" />')).toEqual(['id:table','tag:DataTable','use:rows']);
 expect(selectors('<p>{$visible}</p>')).toEqual(['tag:p']);
 expect(selectors('{$visible}')).toEqual(['use:visible']);
});
it('indexes declaration names and conservative SQL identifier dependencies',()=>{
 const result=selectors('<Query name="filtered">SELECT * FROM rows WHERE score = $minimum</Query>');
 expect(result).toContain('declaration:filtered');expect(result).toContain('dependency:rows');expect(result).toContain('dependency:minimum');
});
it('never reads author-controlled prototype properties as selectors',()=>{
 expect(selectors('<p id="__proto__">Text</p>')).toEqual(['id:__proto__','tag:p']);
});
