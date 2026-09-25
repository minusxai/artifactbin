import {expect,it,vi} from 'vitest';
import {createDocumentGraph,graphIntegrity,graphSource} from '../document-graph';
import {prepareClientDocumentUpdate,prepareClientDocumentPublication} from '../document-update-client';
import {applyGraphPatch} from '../document-graph-patch';
const source='<main id="root"><p id="a">Alpha</p><p id="b">Beta</p></main>';
it('prepares composable client operations without server publication or unrelated cache work',()=>{
 const base=createDocumentGraph(source,1);
 const a=prepareClientDocumentUpdate({document:base,version:1,meta:{}},{operations:[{kind:'setText',path:[0,0,0],value:'Longer α'},{kind:'setAttribute',path:[0,0],name:'title',value:'Tip'}]});
 const b=prepareClientDocumentUpdate({document:base,version:1,meta:{}},{source:source.replace('Beta','Changed β')});
 expect(a.effects).toEqual({css:false,references:false});
 const first=applyGraphPatch(base,1,a.patch)!;const both=applyGraphPatch(first,2,b.patch)!;
 expect(graphIntegrity(both)).toEqual([]);expect(graphSource(both)).toContain('Longer α');expect(graphSource(both)).toContain('Changed β');
});
it('validates legitimate clients and includes dependency membership guards',()=>{
 const base=createDocumentGraph(source,1);
 for(const source of ['<p onClick="bad">Bad</p>','<p>{$missing}</p>'])expect(()=>prepareClientDocumentUpdate({document:base,version:1,meta:{}},{source})).toThrow();
 const declaration='<Helmet><Value name="n" type="number" default={1} /></Helmet><p id="a">{$n}</p>';
 const document=createDocumentGraph(declaration,1);
 expect(()=>prepareClientDocumentUpdate({document,version:1,meta:{}},{source:declaration.replace('<Value name="n" type="number" default={1} />','')})).toThrow();
});
it('invalidates CSS only when its candidate inputs change and guards whole replacement',()=>{
 const document=createDocumentGraph(source,1),base={document,version:1,meta:{}};
 const styled=prepareClientDocumentUpdate(base,{source:source.replace('id="a"','id="a" className="font-bold"')});expect(styled.effects.css).toBe(true);
 const whole=prepareClientDocumentUpdate(base,{source:'<p id="x">New</p>',whole:true});
 expect(whole.patch.reads).toContainEqual({key:'$root',facet:'subtreeVersion',version:1});
});

it('requests authoring context only for affected data, icons, fonts or imported assets',async()=>{
 const verify=vi.fn(async(_source:string)=>{}),base={document:createDocumentGraph(source,1),version:1,meta:{}};
 await prepareClientDocumentPublication(base,{source:source.replace('Alpha','Writing')},verify);
 expect(verify).not.toHaveBeenCalled();
 await prepareClientDocumentPublication(base,{source:source.replace('Alpha','<Icon name="calendar" />')},verify);
 expect(verify).toHaveBeenCalledOnce();expect(verify.mock.calls[0]![0]).toContain('Icon');
 verify.mockRejectedValueOnce(new Error('Unknown font'));
 await expect(prepareClientDocumentPublication(base,{source:'<Helmet><meta name="font-body" content="Missing Font" /></Helmet>'+source},verify)).rejects.toThrow('Unknown font');
});
it('refuses ambiguous legacy anchors before normalization can discard them',()=>{
 const base={document:createDocumentGraph(source,1),version:1,meta:{}};
 for(const anchor of ['"old"','{"old"}'])expect(()=>prepareClientDocumentUpdate(base,{source:`<main><p data-annotation-anchor=${anchor}>First</p><p data-annotation-anchor=${anchor}>Second</p></main>`,whole:true})).toThrow(/ambiguous|duplicate/i);
});
it('reports resource warnings to the author without adding them to the committed operation',async()=>{
 const base={document:createDocumentGraph(source,1),version:1,meta:{}};
 const warnings=[{code:'bad_status',url:'https://example.com/missing.png',fix:'Check the URL'}],received=vi.fn();
 const update=await prepareClientDocumentPublication(base,{source:source+'<img src="https://example.com/missing.png" />'},async()=>({warnings}),received);
 expect(received).toHaveBeenCalledWith(warnings);expect(update).not.toHaveProperty('warnings');
});

it.each([false,true])('keeps formatted sibling text edits independent (preserveSource=%s)',preserveSource=>{
 const formatted='<main id="root">\n  <p id="a">Alpha</p>\n  <p id="b">Beta</p>\n  <p id="c">Gamma</p>\n</main>\n';
 const document=createDocumentGraph(formatted,1,{preserveSource}),base={document,version:1,meta:{}};
 const a=prepareClientDocumentUpdate(base,{source:formatted.replace('Alpha','Changed A')});
 const b=prepareClientDocumentUpdate(base,{source:formatted.replace('Beta','Changed B')});
 expect(a.patch.inserted).toEqual({});expect(a.patch.removed).toEqual([]);
 expect(b.patch.inserted).toEqual({});expect(b.patch.removed).toEqual([]);
 for(const [first,second] of [[a,b],[b,a]]){
  const result=applyGraphPatch(applyGraphPatch(document,1,first!.patch)!,2,second!.patch);
  expect(result).not.toBeNull();expect(graphIntegrity(result!)).toEqual([]);
  expect(graphSource(result!)).toContain('Changed A');expect(graphSource(result!)).toContain('Changed B');
 }
});
