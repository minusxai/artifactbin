import {parseFragment,type DefaultTreeAdapterMap} from 'parse5';
import {escapeHtml} from '@artifactbin/utils/escape';
import {DOMAIN_FOOTER_TEXT} from '@artifactbin/contracts/domain-footer';
import {CARD_RENDER_GENERATION} from '@artifactbin/contracts/og-card';
import type {ArtifactRow} from '@/lib/artifacts';
import {PUBLIC_BASE_URL} from '@/lib/platform';
import {canonicalDocumentUrl} from '@/lib/user-pages';
import {documentHeadTags} from './document-frame';
import {nativeHtmlTitle} from './native-html.server';
interface DomainPresentation {hostname:string}

// Publishing-host pages can omit the platform stylesheet. Keep the credit's styles with its injected markup.
const DOMAIN_FOOTER_STYLE = `<style data-mx-domain-footer-style>
footer[data-mx-domain-footer] {
  padding-inline: clamp(0.75rem, 3vw, 1.5rem);
  text-align: center;
  font-family: var(--font-body, system-ui, sans-serif);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--muted-foreground, color-mix(in oklab, currentColor 80%, transparent));
}
footer[data-mx-domain-footer] > a {
  color: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 0.18em;
}
footer[data-mx-domain-footer] > a:is(:hover, :focus-visible) {
  color: var(--foreground, inherit);
  text-decoration-thickness: 2px;
}
footer[data-mx-domain-footer] > a:focus-visible {
  outline: 2px solid var(--ring, currentColor);
  outline-offset: 2px;
}
</style>`;

/** A document's own head: its title, description, social card and canonical link, from its row (what any reader of it may see). */
export async function documentHeadFor(row:ArtifactRow):Promise<string>{
 const canonical=await canonicalDocumentUrl(row),app=PUBLIC_BASE_URL.replace(/\/+$/,'');
 return documentHeadTags({title:nativeHtmlTitle(row),description:row.description,image:`${app}/a/${row.id}/export?mode=card&v=${row.version}&r=${CARD_RENDER_GENERATION}`})+`<link rel="canonical" href="${escapeHtml(canonical)}">`;
}
/** Render-time presentation only. Saved source and downloadable HTML never acquire platform attribution. */
export async function nativeHtmlPresentation(row:ArtifactRow,domain?:DomainPresentation|null):Promise<(document: DefaultTreeAdapterMap['document']) => void>{
 const tags=await documentHeadFor(row);
 const app=PUBLIC_BASE_URL.replace(/\/+$/,'');
 return document => {
  const root=document.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='html');
  const head=root?.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='head'),body=root?.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='body');
  if(!head||!body)return;
  head.childNodes=head.childNodes.filter(node=>{
   if(!('attrs'in node))return true;
   const attr=(name:string)=>node.attrs.find(a=>a.name===name)?.value;
   return !(node.nodeName==='title'||node.nodeName==='link'&&attr('rel')==='canonical'||node.nodeName==='meta'&&(attr('name')==='description'||attr('name')?.startsWith('twitter:')||attr('property')?.startsWith('og:')));
  });
  for(const node of parseFragment(tags+(domain?DOMAIN_FOOTER_STYLE:'')).childNodes){node.parentNode=head;head.childNodes.push(node);}
  if(domain){
   const footer=`<footer data-mx-domain-footer>${DOMAIN_FOOTER_TEXT} <a href="${escapeHtml(`${app}/a/${row.id}`)}" rel="noopener">artifactbin</a></footer>`;
   for(const node of parseFragment(footer).childNodes){node.parentNode=body;body.childNodes.push(node);}
  }
 };
}
