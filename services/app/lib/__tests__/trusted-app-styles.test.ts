import {readFileSync} from 'node:fs';
import path from 'node:path';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import postcss from 'postcss';
import {expect,it} from 'vitest';
import {scopeTrustedStyles} from '@/web/trusted-styles';

it('scopes the actual compiled app tokens, preflight, fonts and utilities to the inner trusted root', async () => {
  const base=path.resolve(__dirname,'../../web');
  const compiler=await compile(readFileSync(path.resolve(base,'../app/globals.css'),'utf8'),{base,onDependency:()=>{}});
  const compiled=compiler.build(new Scanner({sources:compiler.sources}).scan());
  const css=scopeTrustedStyles(compiled),parsed=postcss.parse(css);
  expect(css.length).toBeGreaterThan(10_000);
  expect(css).not.toMatch(/@import|@theme|:root\b|:host\b/);
  for(const selector of ['.fixed','.inset-0','.font-mono','[data-trusted-ui-root]'])expect(css).toContain(selector);
  const rootTokens=new Map<string,string>();
  parsed.walkRules(rule=>{
    if(rule.selector.split(',').some(selector=>selector.trim()==='[data-trusted-ui-root]'))rule.walkDecls(decl=>{if(decl.prop.startsWith('--'))rootTokens.set(decl.prop,decl.value);});
  });
  for(const name of ['--font-mono','--font-jb-mono','--font-plex-sans','--color-bg','--color-fg','--spacing'])expect(rootTokens.has(name),name).toBe(true);
  expect(css).toContain("[data-trusted-ui-root][data-theme='dark']");
  expect(css).toContain('[data-trusted-ui-root]{background:none;min-height:0;}');
  expect(css).toContain('[data-trusted-ui-root],[data-trusted-ui-root]>div{display:contents;}');
},60_000);
