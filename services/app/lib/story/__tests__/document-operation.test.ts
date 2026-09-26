import {describe,expect,it} from 'vitest';
import {applyDocumentOperations} from '../document-operation';
import {publishJsx} from '../jsx-tier';
const source='<section id="root"><p id="a">Alpha</p><p id="b">Beta</p></section>';
describe('document operation algebra',()=>{
 it('composes text, attributes, insertion, movement and deletion in order',()=>{
  expect(applyDocumentOperations(source,[
   {kind:'setText',path:[0,0,0],value:'A & B'},
   {kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'},
   {kind:'insert',parent:[0],index:1,source:'<div id="c">New</div>'},
   {kind:'move',path:[0,2],parent:[0],index:0},
   {kind:'delete',path:[0,2]},
  ])).toBe('<section id="root"><p id="b">Beta</p><p id="a" className="font-bold">A &amp; B</p></section>');
 });
 it('supports root and nested replacements and removes attributes',()=>{
  expect(applyDocumentOperations(source,[{kind:'replace',path:[0,1],source:'<h2>New</h2><p>Next</p>'},{kind:'removeAttribute',path:[0,0],name:'id'}])).toBe('<section id="root"><p>Alpha</p><h2>New</h2><p>Next</p></section>');
  expect(applyDocumentOperations(source,[{kind:'replaceDocument',source:'<p>Whole</p>'},{kind:'setText',path:[0,0],value:'Final'}])).toBe('<p>Final</p>');
 });
 it('uses post-removal indexes for moves and permits moving out of a parent',()=>{
  expect(applyDocumentOperations(source,[{kind:'move',path:[0,0],parent:[0],index:1}])).toBe('<section id="root"><p id="b">Beta</p><p id="a">Alpha</p></section>');
  expect(applyDocumentOperations(source,[{kind:'move',path:[0,0],parent:[],index:1}])).toBe('<section id="root"><p id="b">Beta</p></section><p id="a">Alpha</p>');
 });
 it.each([
  [{kind:'move',path:[0],parent:[0,0],index:0}],
  [{kind:'delete',path:[0,99]}],
  [{kind:'setText',path:[0],value:'wrong kind'}],
  [{kind:'insert',parent:[0,0,0],index:0,source:'<p />'}],
  [{kind:'insert',parent:[],index:99,source:'<p />'}],
  [{kind:'setAttribute',path:[0],name:'x onClick',value:'x'}],
  [{kind:'delete',path:['__proto__']}],
  [{kind:'delete',path:[-1]}],
  [{kind:'delete',path:[0.5]}],
  [{kind:'replaceDocument',source:'<div>'}],
  [{kind:'unknown',path:[0]}],
  [],
 ].map(operations=>[operations]))('rejects malformed operations without mutating the baseline: %j',(operations)=>{
  expect(()=>applyDocumentOperations(source,operations as never)).toThrow();
  expect(source).toContain('Alpha');
 });
 it('handles static structured attribute values losslessly',()=>{
  const value={z:[null,true,'"{}<>`'],a:1};
  const result=applyDocumentOperations('<Question id="chart" />',[{kind:'setAttribute',path:[0],name:'viz',value}]);
  expect(result).toContain(JSON.stringify(value));
 });
 it('rejects invalid composites as a whole through publisher admission',async()=>{
  const candidate=applyDocumentOperations(source,[{kind:'setText',path:[0,0,0],value:'Safe'},{kind:'setAttribute',path:[0,1],name:'onClick',value:'alert(1)'}]);
  const result=await publishJsx({},candidate,{loadRef:async()=>null});
  expect(result).toBeInstanceOf(Response);expect((result as Response).status).toBe(400);
 });
 it('treats script-looking text as escaped data, not executable input',async()=>{
  const candidate=applyDocumentOperations(source,[{kind:'setText',path:[0,0,0],value:'<script>alert(1)</script>'}]);
  expect(candidate).toContain('&lt;script&gt;');
  expect(await publishJsx({},candidate,{loadRef:async()=>null})).not.toBeInstanceOf(Response);
 });
});
