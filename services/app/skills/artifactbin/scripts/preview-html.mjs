/**
 * Internal: the HTML parser surface of the skill: page decoration for the preview, local reference
 * and dataset/backend link discovery, platform styles, and re-exported autofix and export packing.
 * The downloadable archive bundles this parser (buildPreviewParser); installed previews need only
 * Node.
 * Used by: preview.mjs, preview-*.mjs, publication-bundle.mjs, toolbox-platform.mjs,
 *   toolbox-publish.mjs, autofix.mjs, the skill ZIP route and several parser tests.
 */
export {packPreviewExport} from './preview-export.mjs';
import {parse,parseFragment,serialize} from 'parse5';
import {initSync,parse as parseImports} from 'es-module-lexer';
import parseCss from 'css-tree/parser';
import walkCss from 'css-tree/walker';
initSync();
import {
  admitRuntimeModuleImports} from '../../../lib/html-publication-bundle/runtime-module-imports.ts';
// The shared autofix rules (lib/html-autofix) reach every script through this bundled module.
export {autofixHtml,formatAutofixReport,scriptFingerprint,
  localReferences} from '../../../lib/html-autofix/index.ts';
import {htmlAppearance} from '../../../lib/html-page/design-system.ts';
/** The design system a page names (its meta or <html> attribute), or null. */
export const pageDesignSystem=source=>htmlAppearance(source).designSystem??null;
/** The platform stylesheet for one local page — `css`, its resolved system only, which the
 * preview fetches from the selected server's /af/styles.css?system=NAME (lib/html-systems) —
 * inline first in <head>. */
export function withPlatformStyles(source,css){
 if(!css||!pageDesignSystem(source))return source;
const document=parse(source),html=document.childNodes.find(node=>node.nodeName==='html'),head=
   html?.childNodes.find(node=>node.nodeName==='head');
const present=node=>node.attrs?.some(attr=>attr.name==='data-af'&&attr.value==='platform-styles')||(
   node.childNodes??[]).some(present);
 if(!head||present(document))return source;
const style=parseFragment('<style data-af="platform-styles"></style>').childNodes[0];
   style.childNodes=[{nodeName:'#text',value:css,parentNode:style}];
 style.parentNode=head;head.childNodes.unshift(style);return serialize(document);
}
/** Shared server admission distinguishes literal project dependencies from closed runtime URL
 * adapters. */
export function publicationLocalReferences(source,contentType){
const moduleReferences=text=>{const imports=parseImports(text)[0],runtime=imports.some(item=>
   item.n===undefined&&item.d!==-2)?admitRuntimeModuleImports(text):[];return imports.flatMap(item=>
   {
  if(item.d===-2)return [];
if(item.n===undefined){if(runtime.some(entry=>entry.importStart===item.ss))return [];throw Error(
    'Computed module imports cannot be discovered; use literal imports. Other runtime-loaded '+
    'files must be listed in the publication manifest.');}
return item.n.startsWith('.')||item.n.startsWith('/')||/^[a-z][a-z\d+.-]*:/i.test(item.n)?[item.n]:[
    ];
 });};
 if(contentType==='text/javascript')return moduleReferences(source);
if(contentType==='text/css'){const references=[];walkCss(parseCss(source),function(node){if(
   node.type==='Url'||node.type==='String'&&this.atrule?.name.toLowerCase(
   )==='import')references.push(node.value);});return references;}
 const references=[];
 const walk=node=>{
  if(node.tagName){
if(['img','script','link','source','video','audio','iframe','object','embed','image',
     'use'].includes(node.tagName))for(const attr of node.attrs)if(['src','href','poster'].includes(
     attr.name))references.push(attr.value);
if(node.tagName==='script'&&node.attrs.some(attr=>attr.name==='type'&&
     attr.value==='module'))references.push(...moduleReferences(node.childNodes.map(child=>
     child.value??'').join('')));
   if(node.tagName==='template'&&node.content)walk(node.content);
  }
  for(const child of node.childNodes??[])walk(child);
 };
 walk(parse(source));return references;
}
export function previewHtml(source,notice,localConfig,platformCss){
 const document=parse(localConfig?withPlatformStyles(source,platformCss):source);
 const html=document.childNodes.find(node=>node.nodeName==='html');
 html.attrs=html.attrs.filter(attr=>attr.name!=='data-af-private-preview');
 html.attrs.push({name:'data-af-private-preview',value:'true'});
 if(localConfig){
  // D4: what the core sets on <html> at load, resolved the way the server resolves it.
  localConfig={appearance:htmlAppearance(source),...localConfig};
  let previous={};
function removeRuntime(node){if(!node.childNodes)return;node.childNodes=node.childNodes.filter(
    child=>{if(child.nodeName==='script'&&child.attrs?.some(attr=>attr.name==='data-af'&&
    attr.value==='runtime')){try{previous=JSON.parse(child.childNodes?.map(part=>part.value??
    '').join('')||'{}');}catch{}return false;}removeRuntime(child);return true;});}
  removeRuntime(html);
  const config={...previous,...localConfig};delete config.appOrigin;
const block=parseFragment('<script type="application/json" data-af="runtime">'+JSON.stringify(
    config).replace(/</g,'\\u003c')+'</script>').childNodes[0];
const head=html.childNodes.find(node=>node.nodeName==='head');block.parentNode=head;
    head.childNodes.unshift(block);
 }
 const body=html.childNodes.find(node=>node.nodeName==='body');
for(const node of parseFragment(notice).childNodes){node.parentNode=body;body.childNodes.push(node);
   }
 return serialize(document);
}

/** Return authored declarations only; the server resolves local paths under its root. */
export function previewDatasetLinks(source){
 const document=parse(source),links=[];let baseHref;
 function visit(node){
  const attrs=Object.fromEntries((node.attrs??[]).map(({name,value})=>[name,value]));
  if(node.nodeName==='base'&&baseHref===undefined)baseHref=attrs.href;
if(node.nodeName==='link'&&(attrs.rel??'').split(/\s+/).includes('af-dataset')&&attrs[
    'data-af-name'])links.push({name:attrs['data-af-name'],href:attrs.href??'',table:attrs[
    'data-af-table'],schema:attrs['data-af-schema']});
  for(const child of node.childNodes??[])visit(child);
 }visit(document);return {links,baseHref};
}

/** Backend hrefs are source declarations; a read may explicitly retain their saved remote
 * binding. */
export function previewBackendLinks(source){
const found=[];function walk(node){if(node.tagName==='link'&&node.attrs.some(attr=>
   attr.name==='rel'&&attr.value.split(/\s+/).includes('af-backend'))){const value=name=>
   node.attrs.find(attr=>attr.name===name)?.value;found.push({name:value('data-af-name'),href:value(
   'href')??''});}for(const child of node.childNodes??[])walk(child);if(node.content)walk(
   node.content);}walk(parse(source));return found;
}
