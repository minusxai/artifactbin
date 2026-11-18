// @vitest-environment jsdom
/**
 * A page's own variables win over the platform stylesheet's: a design system's token blocks carry zero specificity, so
 * an author's `:root{--muted:…}` overrides the system's value wherever its `<style>` sits, while a page that sets none
 * keeps the system's values in light and dark. The base body and type roles keep their precedence.
 */
import {afterEach,expect,it} from 'vitest';
import {htmlSystemsCss} from '../index';
import {DESIGN_SYSTEM_VARIABLES} from '../design-variables.server';

const root=document.documentElement;
const sheet=(css:string,where:'before'|'after'='after')=>{const style=document.createElement('style');style.setAttribute('data-test','');style.textContent=css;if(where==='before')document.head.prepend(style);else document.head.append(style);};
const value=(element:Element,name:string)=>getComputedStyle(element).getPropertyValue(name).trim();
const clear=()=>{for(const style of document.head.querySelectorAll('style[data-test]'))style.remove();};
afterEach(()=>{clear();root.removeAttribute('data-af-design-system');root.removeAttribute('data-af-dark');document.body.replaceChildren();});
const graphite=(dark:boolean)=>{root.setAttribute('data-af-design-system','graphite');root.setAttribute('data-af-dark',String(dark));};
const system=(mode:'light'|'dark',name='--muted')=>DESIGN_SYSTEM_VARIABLES.variables('graphite',mode)![name];

it('keeps the system\'s tokens, light and dark, on a page that defines none',()=>{
 sheet(htmlSystemsCss(['graphite']));graphite(false);
 const switched=Object.keys(DESIGN_SYSTEM_VARIABLES.variables('graphite','dark')!).find(name=>system('dark',name)!==system('light',name))!;
 expect(value(root,'--muted')).toBe(system('light'));expect(value(root,switched)).toBe(system('light',switched));
 graphite(true);
 expect(value(root,'--muted')).toBe(system('dark'));expect(value(root,switched)).toBe(system('dark',switched));
});

it('lets a page\'s :root variables win in light and dark, whichever stylesheet comes first',()=>{
 for(const where of ['before','after'] as const){
  sheet(htmlSystemsCss(['graphite']));sheet(':root{--muted:#6b7280}',where);
  graphite(false);expect(value(root,'--muted'),where).toBe('#6b7280');
  graphite(true);expect(value(root,'--muted'),where).toBe('#6b7280');
  clear();
 }
});

it('keeps the system\'s base body over a page\'s plain body rule, as before',()=>{
 sheet('body{margin:8px}','before');sheet(htmlSystemsCss(['graphite']));graphite(false);
 expect(getComputedStyle(document.body).margin).toBe('0px');
});
