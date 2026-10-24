// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {registerTabs} from './tabs';
import {registerInput} from './input';
import {registerTextarea} from './textarea';
import {registerSegmented} from './segmented';
import {registerSelect} from './select';
import {registerDialog} from './dialog';
import {registerPopover} from './popover';
import {registerTooltip} from './tooltip';
import {registerDatePicker} from './date-picker';
import {registerFileUpload} from './file-upload';
import {registerSwitch} from './switch';
import {registerSlider} from './slider';
import {registerAccordion} from './accordion';
for(const register of [registerTabs,registerInput,registerTextarea,registerSegmented,registerSelect,registerDialog,registerPopover,registerTooltip,registerDatePicker,registerFileUpload,registerSwitch,registerSlider,registerAccordion])register();
function declaration(selector:string,property:string):string {
 let result='';
 for(const sheet of [...document.styleSheets])for(const rule of [...sheet.cssRules])if('selectorText'in rule&&(rule as CSSStyleRule).selectorText.split(',').map(value=>value.trim()).includes(selector))result=(rule as CSSStyleRule).style.getPropertyValue(property)||result;
 return result;
}
/** Resolve the shipped CSS variable fallback, without claiming jsdom layout support. */
function radius(value:string,variables:Record<string,string>):number {
 let resolved=value;
 while(resolved.includes('var(')){
  const start=resolved.lastIndexOf('var(');let end=start+4,depth=1;
  for(;end<resolved.length;end++){if(resolved[end]==='(')depth++;if(resolved[end]===')'){depth--;if(depth===0)break;}}
  const body=resolved.slice(start+4,end),comma=body.indexOf(',');
  resolved=resolved.slice(0,start)+(variables[body.slice(0,comma)]??body.slice(comma+1))+resolved.slice(end+1);
 }
 resolved=resolved.replace(/([\d.]+)rem/g,(_,number:string)=>String(Number(number)*16)+'px');
 const fixed=/^([\d.]+)px$/.exec(resolved);if(fixed)return Number(fixed[1]);
 const calc=/^calc\(([\d.]+)px - ([\d.]+)px\)$/.exec(resolved);if(calc)return Math.max(0,Number(calc[1])-Number(calc[2]));
 throw Error('Unresolved radius: '+resolved);
}
/** story-css.server.ts @theme scale; kit recipes use rounded-sm/md/lg. */
interface RadiusContract {selector:string;size:'sm'|'md'|'lg'}
const contracts:RadiusContract[]=[
 {selector:'af-tabs-list',size:'lg'},{selector:'af-tabs-trigger',size:'md'},
 {selector:'af-input>.af-text-control',size:'md'},{selector:'af-textarea>.af-text-control',size:'md'},
 {selector:'af-segmented .af-segmented-options',size:'md'},{selector:'af-select .af-select-trigger',size:'md'},
 {selector:'af-select .af-select-popup',size:'md'},{selector:'af-select input',size:'sm'},
 {selector:'af-select [role=option]',size:'sm'},{selector:'dialog[data-af-dialog-native]',size:'lg'},
 {selector:'af-dialog-trigger',size:'md'},{selector:'af-dialog-close',size:'md'},
 {selector:'af-popover-content',size:'md'},{selector:'af-tooltip-content',size:'md'},
 {selector:'af-date-picker .af-date-trigger',size:'md'},{selector:'af-date-picker .af-date-popup',size:'md'},
 {selector:'af-date-picker button',size:'sm'},{selector:'af-file-upload .af-file-upload-drop',size:'md'},
 {selector:'af-file-upload button',size:'md'},{selector:'af-file-upload img',size:'sm'},
 {selector:'af-accordion-trigger',size:'md'},
];
it('uses the retained rounded-sm/md/lg scale when a theme supplies only --radius',()=>{
 for(const contract of contracts){const css=declaration(contract.selector,'border-radius');
  for(const base of [4,10,16])expect(radius(css,{'--radius':`${base}px`}),contract.selector).toBe(Math.max(0,base-({sm:4,md:2,lg:0}[contract.size])));
  expect(radius(css,{[`--radius-${contract.size}`]:'12px'}),contract.selector+' explicit override').toBe(12);
  expect(radius(css,{}),contract.selector+' neutral fallback').toBe(10-({sm:4,md:2,lg:0}[contract.size]));
 }
 expect(declaration('af-segmented .af-segmented-options>button[data-segment-option]','border-radius')).toBe('5px');
});
it('keeps control captions and select typography consistent with retained controls in every theme',()=>{
 for(const selector of ['af-input>label[data-af-control-label]','af-textarea>label[data-af-control-label]','af-segmented .af-segmented-label','af-select .af-select-label','af-switch .af-switch-label','af-slider>label']){
  expect(declaration(selector,'font-size'),selector).toBe('11px');expect(declaration(selector,'font-weight'),selector).toBe('500');expect(declaration(selector,'text-transform'),selector).toBe('uppercase');expect(parseFloat(declaration(selector,'letter-spacing')),selector).toBe(.05);
 }
 expect(parseFloat(declaration('af-select button','font-size'))).toBe(.875);
 expect(parseFloat(declaration('af-select input','font-size'))).toBe(.875);
 expect(declaration('af-select .af-select-trigger','height')).toBe('2.25rem');
});
it('keeps overlay elevation a black shadow in light and dark themes',()=>{
 for(const selector of ['af-popover-content','af-tooltip-content','dialog[data-af-dialog-native]']){
  const shadow=declaration(selector,'box-shadow');expect(shadow).not.toContain('--foreground');expect(shadow).toContain('rgb(0 0 0 / 10%)');
 }
});

it('sizes native select and date buttons independently of a global reset and retains accordion type',()=>{
 for(const selector of ['af-select button','af-select input','af-date-picker button'])expect(declaration(selector,'box-sizing'),selector).toBe('border-box');
 expect(parseFloat(declaration('af-accordion-trigger','font-size'))).toBe(.875);
 expect(declaration('af-accordion-trigger','font-weight')).toBe('500');
});
