import {describe,expect,it} from 'vitest';
import {annotationSplit} from '../annotation-layers';
import {resizeVegaView} from '../chart-plan';

describe('native annotation layers',()=>{
 it('splits an annotated unit into its base chart and datum-only rule/rect/text layers',()=>{
  const unit={mark:'line',encoding:{x:{field:'d'},y:{field:'n'}}};
  expect(annotationSplit(unit)).toEqual({unit,annotations:[]});
  const rule={mark:'rule',encoding:{y:{datum:10}}},label={mark:{type:'text'},encoding:{y:{datum:10},text:{value:'goal'}}};
  expect(annotationSplit({layer:[unit,rule,label]})).toEqual({unit,annotations:[rule,label]});
  // A field-encoded or non-annotation layer keeps the spec custom; so does any other composition or a lone layer.
  for(const spec of [{layer:[unit,{mark:'rule',encoding:{y:{field:'n'}}}]},{layer:[unit,{mark:'bar',encoding:{y:{datum:1}}}]},{layer:[unit,{mark:'rule'}]},{layer:[unit,{mark:'rule',encoding:{y:null}}]},{layer:[unit]},{layer:[unit,rule],hconcat:[]}])expect(annotationSplit(spec)).toBeNull();
 });

});

describe('render pipeline seams',()=>{
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
