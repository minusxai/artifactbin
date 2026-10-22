import test from 'node:test';import assert from 'node:assert/strict';
import{parse,generate,walk}from'css-tree';
import{isolateArchivedThemeVariables}from'../src/migration/conversion/compiled/legacy-theme.ts';
const rules=(css:string)=>{const out:{selector:string;properties:string[]}[]=[];walk(parse(css),(n:any)=>{if(n.type==='Rule')out.push({selector:generate(n.prelude),properties:[...n.block.children].filter((n:any)=>n.type==='Declaration').map((n:any)=>n.property)});});return out;};
test('archived root theme vars get same-specificity story copies in original cascade contexts',()=>{
 const css=':root{--foreground:red;color:blue}:root:where([data-theme="ink"].dark){--foreground:white!important}@media(min-width:1px){:where(:root[data-theme="ink"]){--font-mono:monospace}}';
 const result=isolateArchivedThemeVariables(css),r=rules(result);assert.deepEqual(r.map(x=>x.selector),[':root','[data-mx-inline-story]',':root:where([data-theme="ink"].dark)','[data-mx-inline-story]:where([data-theme="ink"].dark)',':where(:root[data-theme="ink"])',':where([data-mx-inline-story][data-theme="ink"])']);
 assert.deepEqual(r[1]?.properties,['--foreground']);assert.match(result,/@media[\s\S]+\[data-mx-inline-story\][\s\S]+}}$/);assert.match(result,/--foreground:white!important/);
});
test('normalization never rewrites arbitrary root body or descendant styling and never copies ordinary declarations',()=>{
 const css='body{--background:red}:root .child{--foreground:blue}:root:hover{--foreground:red}:root{color:blue}.dark{--foreground:white}';
 const result=isolateArchivedThemeVariables(css);assert.ok(!result.includes('[data-mx-inline-story]'));assert.deepEqual(rules(result).map(x=>x.properties),rules(css).map(x=>x.properties));
});

test('source default font floor and explicit root fonts beat inherited platform defaults without defeating authored story fonts',()=>{
 const css='html,:host{font-family:var(--default-font-family, sans-serif);line-height:1.5}[data-mx-inline-story]{font-family:Custom}:root:where([data-theme="ink"]){font-family:var(--font-body)}';
 const r=rules(isolateArchivedThemeVariables(css));assert.deepEqual(r.map(x=>x.selector),['html,:host',':where([data-mx-inline-story])','[data-mx-inline-story]',':root:where([data-theme="ink"])','[data-mx-inline-story]:where([data-theme="ink"])']);assert.deepEqual(r[1]?.properties,['font-family']);
 assert.ok(!isolateArchivedThemeVariables('body{font-family:Custom}html,:host{font-family:Unexpected}').includes('data-mx-inline-story'));
});
