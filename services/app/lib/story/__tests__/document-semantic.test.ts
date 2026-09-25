import {expect,it} from 'vitest';
import {createSemanticDocument,prepareSemanticOperation,prepareSemanticSource,semanticPlan,applySemanticPlan} from '../document-semantic';
import {decodeDocument} from '../document-codec';
import {publishJsx} from '../jsx-tier';
const context={loadRef:async()=>null};
async function setup(source='<section id="root"><p id="a">Alpha</p><p id="b">Beta</p></section>'){
 const published=await publishJsx({},source,context);if(published instanceof Response)throw new Error(await published.text());
 return {id:'test',version:1,document:createSemanticDocument(published.source!,1),meta:published.meta};
}
it('projects safe prose in rich documents and round-trips exact source',async()=>{
 const base=await setup('<Helmet><style>{`p { color: red }`}</style></Helmet><section id="root"><h1 id="a">Heading</h1><p id="b">Body</p></section>');
 expect(Object.values(base.document.prose).map(p=>p.value)).toEqual(['Heading','Body']);
 expect(decodeDocument(base.document)).toContain('p { color: red }');
});
it('structural admission preserves a concurrent independent text change',async()=>{
 const base=await setup();
 const token=await prepareSemanticOperation(base,[{kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'}],context);
 expect(token).not.toBeInstanceOf(Response);if(token instanceof Response)throw new Error(await token.text());
 const current=structuredClone(base.document),slot=Object.entries(current.prose).find(([,p])=>p.value==='Beta')!;
 current.prose[slot[0]]={...slot[1],value:'New β',source:'New β',units:5,bytes:6,revision:2};current.bytes+=2;
 const result=applySemanticPlan(current,2,token);
 expect(decodeDocument(result!)).toContain('New β');expect(decodeDocument(result!)).toContain('className="font-bold"');
 expect(await publishJsx({},decodeDocument(result!),context)).not.toBeInstanceOf(Response);
});
it('a replaced or deleted leaf is an atomic dependency, including ABA revisions',async()=>{
 const base=await setup(),token=await prepareSemanticOperation(base,[{kind:'delete',path:[0,0]}],context);
 if(token instanceof Response)throw new Error(await token.text());
 const slot=Object.keys(base.document.prose).find(id=>base.document.prose[id]!.value==='Alpha')!;
 const current=structuredClone(base.document);current.prose[slot]!.revision=3;
 expect(applySemanticPlan(current,3,token)).toBeNull();
 expect(applySemanticPlan(base.document,1,token)).not.toBeNull();
});
it('all structural vocabulary is admitted by the full publisher',async()=>{
 const base=await setup();
 const token=await prepareSemanticOperation(base,[{kind:'insert',parent:[0],index:1,source:'<h2>New</h2>'},{kind:'move',path:[0,2],parent:[0],index:0},{kind:'replace',path:[0,2],source:'<p>Final</p>'},{kind:'removeAttribute',path:[0,1],name:'id'}],context);
 expect(token).not.toBeInstanceOf(Response);
 const bad=await prepareSemanticOperation(base,[{kind:'setAttribute',path:[0],name:'onClick',value:'run()'}],context);
 expect(bad).toBeInstanceOf(Response);
});
it('does not accept fabricated admission tokens or changed semantic baselines',async()=>{
 expect(()=>semanticPlan({} as never)).toThrow();
 const base=await setup(),token=await prepareSemanticOperation(base,[{kind:'replaceDocument',source:'<p>New</p>'}],context);
 if(token instanceof Response)throw new Error(await token.text());
 expect(applySemanticPlan({...base.document,epoch:'other'},1,token)).toBeNull();
});

it('an ancestor attribute change depends on its descendants but not a sibling paragraph',async()=>{
 const base=await setup(),token=await prepareSemanticOperation(base,[{kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'}],context);if(token instanceof Response)throw new Error(await token.text());
 const current=structuredClone(base.document),slot=Object.keys(current.prose).find(k=>current.prose[k]!.value==='Alpha')!;current.prose[slot]!.revision=2;
 expect(applySemanticPlan(current,2,token)).toBeNull();
});

it('rejects a prose expansion beyond the document limit during admission',async()=>{
 const base=await setup();
 const result=await prepareSemanticOperation(base,[{kind:'setText',path:[0,0,0],value:'x'.repeat(2_000_001)}],context);
 expect(result).toBeInstanceOf(Response);
 expect((result as Response).status).toBe(413);
});

it('source admission retains independent slots after JSONB object-key reordering',async()=>{
 const base=await setup();
 const reorder=(v:unknown):unknown=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,reorder(x)])):v;
 base.document=reorder(base.document) as typeof base.document;
 const candidate=decodeDocument(base.document).replace('<p id="a">','<p id="a" title="Changed">');
 const token=await prepareSemanticSource(base,candidate,context);if(token instanceof Response)throw new Error(await token.text());
 expect(semanticPlan(token).reads).toHaveLength(1);
 const beta=Object.keys(base.document.prose).find(k=>base.document.prose[k]!.value==='Beta')!;
 expect(semanticPlan(token).removed).not.toContain(beta);
});
