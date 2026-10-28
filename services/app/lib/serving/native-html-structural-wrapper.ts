import {parse,parseFragment,serialize,type DefaultTreeAdapterMap} from 'parse5';
import {STORY_BARE_TEXT_CSS} from '@/lib/story-surface/bare-typography';

const STRUCTURAL_DOC_CSS=':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled])>.mx-doc){line-height:1.5}:where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))>.mx-doc{padding-inline:0;padding-block-start:0;padding-block-end:0}';
const INLINE_BARE_TYPOGRAPHY_CSS=STORY_BARE_TEXT_CSS
 .replaceAll(':where([data-mx-story-root]:not([data-mx-styled]))',':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))')
 .replaceAll(':where([data-mx-story-root])',':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))');

function hasStructuralBareDocRoot(node:DefaultTreeAdapterMap['node']):boolean{
 if('attrs'in node){
  const attrs=new Set(node.attrs.map(attr=>attr.name));
  const root=attrs.has('data-mx-story-root')&&attrs.has('data-mx-inline-story')&&!attrs.has('data-mx-styled');
  if(root&&'childNodes'in node&&node.childNodes.some(child=>'attrs'in child&&child.attrs.some(attr=>attr.name==='class'&&attr.value.split(/\s+/).includes('mx-doc'))))return true;
 }
 return 'childNodes'in node&&node.childNodes.some(hasStructuralBareDocRoot);
}

/** Add reader-owned wrapper geometry at render time without changing saved HTML. */
export function nativeHtmlStructuralWrapper(html:string):string{
 const document=parse(html),root=document.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='html');
 const head=root?.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='head');
 const body=root?.childNodes.find((node):node is DefaultTreeAdapterMap['element']=>node.nodeName==='body');
 if(!head||!body||!hasStructuralBareDocRoot(body)||head.childNodes.some(node=>'attrs'in node&&node.nodeName==='style'&&node.attrs.some(attr=>attr.name==='data-mx-native-html-presentation')))return html;
 const hasBareTypographySheet=head.childNodes.some(node=>'attrs'in node&&['style','link'].includes(node.nodeName)&&node.attrs.some(attr=>attr.name==='data-mx-bare-type'));
 const css=[...(!hasBareTypographySheet?[INLINE_BARE_TYPOGRAPHY_CSS]:[]),STRUCTURAL_DOC_CSS].join('\n');
 // These are reader defaults. Put them before author styles so authored rules
 // retain the normal final say in the cascade.
 for(const node of parseFragment(`<style data-mx-native-html-presentation>${css}</style>`).childNodes){node.parentNode=head;head.childNodes.unshift(node);}
 return serialize(document);
}
