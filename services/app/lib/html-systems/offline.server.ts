/** The active system for exports and offline copies: its rules and faces inline, its font bytes admitted for embedding. */
import {parse,parseFragment,serialize,type DefaultTreeAdapterMap} from 'parse5';
import {htmlAppearance} from '../html-page';
import {htmlSystemFontPaths,htmlSystemsCss} from './index';
import {platformFontBytes} from './fonts.server';

export interface OfflineSystemStyle { html: string; resources: Array<{url:string;contentType:string;bytes:Uint8Array}> }

/** Prepend `<style data-af="platform-styles">` with only the page's resolved system; no system, no change. */
export function withOfflineSystemStyle(html:string,baseUrl:string,ownerChoice?:string|null):OfflineSystemStyle{
 const {designSystem}=htmlAppearance(html,ownerChoice);
 if(!designSystem)return {html,resources:[]};
 const document=parse(html);
 const root=document.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='html');
 const head=root?.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='head');
 if(!head)return {html,resources:[]};
 const style=parseFragment(`<style data-af="platform-styles"></style>`).childNodes[0] as DefaultTreeAdapterMap['element'];
 const css=htmlSystemsCss([designSystem]);
 style.childNodes=[{nodeName:'#text',value:css,parentNode:style} as DefaultTreeAdapterMap['textNode']];
 style.parentNode=head;head.childNodes.unshift(style);
 const resources=htmlSystemFontPaths([designSystem]).map(fontPath=>{
  const bytes=platformFontBytes(fontPath);
  if(!bytes)throw Error('Unsupported font path');
  return {url:new URL(fontPath,baseUrl).href,contentType:'font/woff2',bytes};
 });
 return {html:serialize(document),resources};
}
