import {parse,parseFragment,serialize,type DefaultTreeAdapterMap} from 'parse5';
import {escapeHtml} from '@artifactbin/utils/escape';
import {DOMAIN_FOOTER_TEXT} from '@artifactbin/contracts/domain-footer';
import {CARD_RENDER_GENERATION} from '@artifactbin/contracts';
import type {ArtifactRow} from '@/lib/artifacts';
import {PUBLIC_BASE_URL} from '@/lib/platform';
import {canonicalDocumentUrl} from '@/lib/custom-domains';
import {documentHeadTags} from './document-frame';
import {nativeHtmlTitle} from './native-html.server';
interface DomainPresentation {hostname:string;homepage?:boolean;path?:string}
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
 if(domain){
  const footer=`<footer data-mx-domain-footer>${DOMAIN_FOOTER_TEXT} <a href="${escapeHtml(`${app}/a/${row.id}`)}" rel="noopener">artifactbin</a></footer>`;
  for(const node of parseFragment(footer).childNodes){node.parentNode=body;body.childNodes.push(node);}
 }
 return serialize(document);
}
