/** Native editor DOM is a render boundary: never forward handlers or executable tags. */
import type {DocumentJson} from '@artifactbin/contracts';
import {hasDangerousScheme} from '../jsx/validate';

const tags=new Set('div span section article header footer aside main figure figcaption p h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code img br hr strong em b i small'.split(' '));
export function canvasTag(tag:unknown):string{return typeof tag==='string'&&tags.has(tag)?tag:'div';}
export function canvasAttributes(props:Record<string,DocumentJson>):Record<string,string>{
 const result:Record<string,string>={};
 for(const [key,value] of Object.entries(props)){
  if(typeof value!=='string'&&typeof value!=='number')continue;
  if(!['id','className','title','alt','src','width','height'].includes(key)&&!key.startsWith('data-')&&!key.startsWith('aria-'))continue;
  if(key==='src'&&hasDangerousScheme(String(value)))continue;
  result[key==='className'?'class':key]=String(value);
 }
 return result;
}
