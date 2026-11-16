/** A workload's static page may style and link its content, but never load author-controlled active/network content. */
import {parse} from 'parse5';
import type {DefaultTreeAdapterMap} from 'parse5';
import {RUNTIME_CORE_PATH} from './core-script';
const active=new Set(['iframe','frame','frameset','object','embed','applet','portal','form','input','button','textarea','select','base','foreignobject','animate','animatemotion','animatetransform','set','audio','video','source','track']);
const loading=new Set(['src','srcset','imagesrcset','poster','background','data','codebase','archive','action','formaction','ping','srcdoc','xlink:href','xml:base']);
function staticCss(css:string):boolean {
 // CSS escapes can spell any loading token. Static output needs none; refuse them rather than guess at decoding.
 if(css.includes('\\'))return false;
 const normalized=css.replace(/\/\*[\s\S]*?\*\//g,'');
 return !/(?:url|image|image-set|expression)\s*\(|@\s*(?:import|namespace|font-face)\b/i.test(normalized);
}
export function isStaticWorkloadHtml(html:string):boolean {
 const visit=(node:DefaultTreeAdapterMap['node']):boolean=>{
  if('tagName' in node){
   const tag=node.tagName.toLowerCase(),attrs=new Map(node.attrs.map(attr=>[attr.prefix?attr.prefix+':'+attr.name:attr.name,attr.value]));
   if(active.has(tag))return false;
   if(tag==='script'){
    if(attrs.get('src')!==RUNTIME_CORE_PATH||node.attrs.some(attr=>!['src','data-af','data-af-id'].includes(attr.name))||node.childNodes.some(child=>'value' in child&&child.value.trim()))return false;
   }
   if(tag==='meta'&&attrs.has('http-equiv'))return false;
   for(const [name,value] of attrs){
    if(['fill','stroke','filter','clip-path','mask','cursor'].includes(name)&&!staticCss(value))return false;
    if(name.startsWith('on')||name==='is'||(name==='style'&&!staticCss(value)))return false;
    if(loading.has(name)&&!(tag==='script'&&name==='src'&&value===RUNTIME_CORE_PATH))return false;
    if(name==='href'){
     if(tag!=='a')return false;
     const compact=value.replace(/[\u0000-\u0020\u007f]+/g,'');
     if(/^[a-z][a-z0-9+.-]*:/i.test(compact)&&!/^https?:|^mailto:|^tel:/i.test(compact))return false;
    }
   }
   if(tag==='style'&&!staticCss(node.childNodes.map(child=>'value' in child?child.value:'').join('')))return false;
  }
  if('childNodes' in node&&!node.childNodes.every(visit))return false;
  return !('content' in node)||visit(node.content);
 };
 return visit(parse(html));
}
