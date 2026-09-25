import {expect,it} from 'vitest';
import {proseOperation,applyProseOperation,inertProse} from '../document-prose';
import {publishJsx} from '../jsx-tier';
it.each(['β 👩🏽‍💻','<script>run()</script>','A & B','quotes " and apostrophe \'','line\nbreak',' leading and trailing ','&#123;','braces { literal }'])('an admitted leaf preserves full publication validity: %s',async value=>{
 const before='<section id="root"><p id="p">Alpha</p></section>';
 const source=applyProseOperation(before,{path:['roots','0','children','0','children','0','value'],oldText:'Alpha',newText:value});expect(source).not.toBeNull();
 const published=await publishJsx({},source!);expect(published).not.toBeInstanceOf(Response);if(published instanceof Response)throw new Error(await published.text());expect(published.source).toBe(source);
 const op=proseOperation(before,source!);expect(op).not.toBeNull();expect(applyProseOperation(before,op!)).toBe(source);
});
it('suggests independently editable prose inside rich documents without claiming server admission',()=>{
 const source='<Helmet><style>{`p { color: red }`}</style></Helmet><section><p>Text</p></section>';
 expect(proseOperation(source,source.replace('Text','Changed'))).not.toBeNull();
});
it.each(['className="x"','<style>x</style>','{$_row.name}','\0','\ud800','\r\n','/people/person'])('contextual tokens are not independent prose: %s',value=>expect(inertProse(value)).toBe(false));
it('structural or composite changes cannot masquerade as a single text operation',()=>{
 const before='<p id="a">Alpha</p><p id="b">Beta</p>';
 for(const after of [before.replace('id="a"','id="other"'),before.replace('Alpha','A').replace('Beta','B'),before+'<p>New</p>'])expect(proseOperation(before,after)).toBeNull();
});
