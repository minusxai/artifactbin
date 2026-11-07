import {parse,parseFragment,serialize,type DefaultTreeAdapterMap} from 'parse5';

/**
 * Pages saved by the retired story renderer: an unstyled inline-story root (`[data-mx-story-root][data-mx-inline-story]`
 * without `data-mx-styled`) around `.mx-doc`. Not Markdown: arbitrary authored HTML that also holds components, so these
 * defaults reach BARE elements only (`:not([class])` keeps component internals and authored classes out) and give the
 * reading measure; Markdown-shaped text uses the one Markdown stylesheet (lib/html-components markdown-styles).
 */
const LEGACY_ROOT=':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))';
const bare=(selector:string)=>`${LEGACY_ROOT} :where(${selector}):not([class])`;
export const LEGACY_STORY_TEXT_CSS=[
 `${bare('p,ul,ol,blockquote,table,pre')}{margin-block:0.75em;max-width:68ch;line-height:1.65}`,
 `${bare('h1,h2,h3,h4,h5,h6')}{margin-block:1.6em 0.5em;line-height:1.2;font-weight:600;text-wrap:balance}`,
 `${bare('h1')}{font-size:2.5rem;margin-block-start:0}`,
 `${bare('h2')}{font-size:1.75rem}`,
 `${bare('h3')}{font-size:1.35rem}`,
 `${bare('h4,h5,h6')}{font-size:1.1rem}`,
 `${bare('ul')}{list-style:disc;padding-inline-start:1.4em}`,
 `${bare('ol')}{list-style:decimal;padding-inline-start:1.4em}`,
 `${bare('li')}{margin-block:0.3em}`,
 `${bare('blockquote')}{padding-inline-start:1em;border-inline-start:3px solid currentColor;opacity:0.8}`,
 `${bare('a')}{text-decoration:underline;text-underline-offset:2px}`,
 // A bare table sizes to its rows, never stretched to the column.
 `${bare('table')}{border-collapse:collapse}`,
 `${bare('th,td')}{border:1px solid currentColor;padding:0.4em 0.6em;text-align:start}`,
 `${bare('pre')}{padding:0.9em;overflow-x:auto;border-radius:6px;background:color-mix(in srgb, currentColor 8%, transparent)}`,
 `${bare('hr')}{margin-block:2em;border:0;border-top:1px solid currentColor;opacity:0.25}`,
 `@media (max-width:639px){${bare('h1')}{font-size:2rem}${bare('h2')}{font-size:1.5rem}${bare('h3')}{font-size:1.25rem}}`,
].join('');
const STRUCTURAL_DOC_CSS=`${LEGACY_ROOT.slice(0,-1)}>.mx-doc){line-height:1.5}${LEGACY_ROOT}>.mx-doc{padding-inline:0;padding-block-start:0;padding-block-end:0}`;

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
 const css=[...(!hasBareTypographySheet?[LEGACY_STORY_TEXT_CSS]:[]),STRUCTURAL_DOC_CSS].join('\n');
 // These are reader defaults. Put them before author styles so authored rules
 // retain the normal final say in the cascade.
 for(const node of parseFragment(`<style data-mx-native-html-presentation>${css}</style>`).childNodes){node.parentNode=head;head.childNodes.unshift(node);}
 return serialize(document);
}
