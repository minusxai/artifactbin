// @vitest-environment jsdom
/**
 * ONE Markdown stylesheet (../markdown-styles): docs get it from the platform stylesheet their design system links
 * (lib/html-systems), af-markdown injects the same constant for pages without one. Every rule is zero-specificity, so a
 * design system or a page's own `<style>` wins without !important.
 */
import {afterEach,describe,expect,it} from 'vitest';
import {MARKDOWN_CSS,MARKDOWN_ROOT} from '../markdown-styles';
import {htmlSystemsCss} from '@/lib/html-systems';
import '../markdown';

afterEach(()=>{document.body.replaceChildren();for(const style of document.head.querySelectorAll('style[data-test]'))style.remove();});
const sheet=(css:string)=>{const style=document.createElement('style');style.setAttribute('data-test','');style.textContent=css;document.head.append(style);return style;};

/** Top-level selector branches of every rule (at-rule preludes excluded). */
function selectorsOf(css:string):string[]{
 const out:string[]=[];
 for(const match of css.matchAll(/([^{}]+)\{/g)){
  const prelude=match[1]!.trim();if(!prelude||prelude.startsWith('@'))continue;
  let depth=0,start=0;
  for(let i=0;i<prelude.length;i++){const c=prelude[i];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(c===','&&depth===0){out.push(prelude.slice(start,i).trim());start=i+1;}}
  out.push(prelude.slice(start).trim());
 }
 return out;
}
/** What is left of a selector once its `:where(...)` groups and pseudo-elements are removed: specificity-bearing parts. */
function outsideWhere(selector:string):string{
 let rest='';
 for(let i=0;i<selector.length;i++){
  if(selector.startsWith(':where(',i)){let depth=0;for(;i<selector.length;i++){if(selector[i]==='(')depth++;else if(selector[i]===')'&&--depth===0)break;}continue;}
  rest+=selector[i];
 }
 return rest.replace(/::(before|after|marker)/g,'').replace(/[\s>+~]+/g,'');
}

describe('the Markdown stylesheet',()=>{
 it('is one constant, carried by the platform stylesheet and by af-markdown alike',()=>{
  expect(htmlSystemsCss()).toContain(MARKDOWN_CSS);
  expect(htmlSystemsCss(['meridian'])).toContain(MARKDOWN_CSS);
  const el=document.createElement('af-markdown');el.textContent='# Notes\n\n- one';document.body.append(el);
  expect(document.querySelector('style[data-af-markdown-styles]')!.textContent).toContain(MARKDOWN_CSS);
  // The component's output is the same root a doc's article carries.
  expect(el.querySelector(MARKDOWN_ROOT)).not.toBeNull();
  expect(el.querySelector(MARKDOWN_ROOT)!.contains(el.querySelector('h1'))).toBe(true);
 });

 it('is zero-specificity in every selector, so design systems and page CSS override it',()=>{
  const selectors=selectorsOf(MARKDOWN_CSS);
  expect(selectors.length).toBeGreaterThan(20);
  expect(selectors.filter(selector=>outsideWhere(selector)!=='')).toEqual([]);
 });

 it('styles a doc article and af-markdown output the same way',()=>{
  sheet(MARKDOWN_CSS);
  const article=document.createElement('article');article.setAttribute(MARKDOWN_ROOT.slice(1,-1),'');article.innerHTML='<h2>Doc</h2><p>Text</p>';document.body.append(article);
  const el=document.createElement('af-markdown');el.textContent='## Doc\n\nText';document.body.append(el);
  for(const property of ['line-height','font-weight','letter-spacing','margin-block-end'] as const){
   expect(getComputedStyle(el.querySelector('h2')!).getPropertyValue(property),property).toBe(getComputedStyle(article.querySelector('h2')!).getPropertyValue(property));
  }
  expect(getComputedStyle(article).lineHeight).toBe('1.7');
  expect(getComputedStyle(el.querySelector(MARKDOWN_ROOT)!).lineHeight).toBe('1.7');
 });

 it('loses to a page-level <style> override, even one that comes before a later-injected copy',()=>{
  sheet(htmlSystemsCss(['meridian']));
  sheet('article{line-height:1.4}h2{letter-spacing:normal}');
  // af-markdown appends its own copy of the sheet after the page's styles.
  const el=document.createElement('af-markdown');el.textContent='x';document.body.append(el);
  const article=document.createElement('article');article.setAttribute(MARKDOWN_ROOT.slice(1,-1),'');article.innerHTML='<h2>Doc</h2>';document.body.append(article);
  expect(getComputedStyle(article).lineHeight).toBe('1.4');
  expect(getComputedStyle(article.querySelector('h2')!).letterSpacing).toBe('normal');
 });

 it('leaves an element outside a Markdown root alone',()=>{
  sheet(MARKDOWN_CSS);
  const plain=document.createElement('article');plain.innerHTML='<h2>Plain</h2>';document.body.append(plain);
  expect(getComputedStyle(plain).lineHeight).not.toBe('1.7');
  expect(getComputedStyle(plain.querySelector('h2')!).letterSpacing).not.toBe('-0.02em');
 });
});
