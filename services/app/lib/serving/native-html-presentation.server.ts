import {parse,parseFragment,serialize,type DefaultTreeAdapterMap} from 'parse5';
import {escapeHtml} from '@artifactbin/utils/escape';
import {DOMAIN_FOOTER_TEXT} from '@artifactbin/contracts/domain-footer';
import {CARD_RENDER_GENERATION} from '@artifactbin/contracts';
import type {ArtifactRow} from '@/lib/artifacts';
import {PUBLIC_BASE_URL} from '@/lib/platform';
import {canonicalDocumentUrl} from './custom-domains';
import {documentHeadTags} from './document-frame';
import {nativeHtmlTitle} from './native-html.server';
interface DomainPresentation {hostname:string;homepage?:boolean;path?:string}
const STRUCTURAL_DOC_CSS=':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))>.mx-doc{padding-inline:0;padding-block-start:0;padding-block-end:0}';
function hasStructuralBareDocRoot(node:DefaultTreeAdapterMap['node']):boolean{
 if('attrs'in node){
  const attrs=new Map(node.attrs.map(attr=>[attr.name,attr.value]));
  const root=attrs.has('data-mx-story-root')&&attrs.has('data-mx-inline-story')&&!attrs.has('data-mx-styled');
  if(root&&'childNodes'in node&&node.childNodes.some(child=>'attrs'in child&&child.attrs.some(attr=>attr.name==='class'&&attr.value.split(/\s+/).includes('mx-doc'))))return true;
 }
 return 'childNodes'in node&&node.childNodes.some(hasStructuralBareDocRoot);
}
/** Render-time presentation only. Saved source and downloadable HTML never acquire platform attribution. */
export async function nativeHtmlPresentation(html:string,row:ArtifactRow,domain?:DomainPresentation|null):Promise<string>{
 const document=parse(html),root=document.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='html');
 const head=root?.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='head'),body=root?.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='body');
 if(!head||!body)return html;
 const canonical=await canonicalDocumentUrl(row),app=PUBLIC_BASE_URL.replace(/\/+$/,'');
 head.childNodes=head.childNodes.filter(node=>{
  if(!('attrs'in node))return true;
  const attr=(name:string)=>node.attrs.find(a=>a.name===name)?.value;
  return !(node.nodeName==='title'||node.nodeName==='link'&&attr('rel')==='canonical'||node.nodeName==='meta'&&(attr('name')==='description'||attr('name')?.startsWith('twitter:')||attr('property')?.startsWith('og:')));
 });
 const tags=documentHeadTags({title:nativeHtmlTitle(row),description:row.description,image:`${app}/a/${row.id}/export?mode=card&v=${row.version}&r=${CARD_RENDER_GENERATION}`})+`<link rel="canonical" href="${escapeHtml(canonical)}">`;
 for(const node of parseFragment(tags).childNodes){node.parentNode=head;head.childNodes.push(node);}
 // The imported reader's bare-page rule sees `.mx-doc` as its first child and
 // applies the same gutter meant for authored content. This wrapper is the
 // reader's structural column; cancel only that direct-child padding for the
 // normal reader response, leaving stored HTML and authored descendants intact.
 if(hasStructuralBareDocRoot(body)){
  for(const node of parseFragment(`<style data-mx-native-html-presentation>${STRUCTURAL_DOC_CSS}</style>`).childNodes){node.parentNode=head;head.childNodes.push(node);}
 }
 if(domain){
  const footer=`<footer data-mx-domain-footer>${DOMAIN_FOOTER_TEXT} <a href="${escapeHtml(`${app}/a/${row.id}`)}" rel="noopener">artifactbin</a></footer>`;
  for(const node of parseFragment(footer).childNodes){node.parentNode=body;body.childNodes.push(node);}
 }
 return serialize(document);
}
