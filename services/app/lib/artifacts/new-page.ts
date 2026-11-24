/** Permanent new-head boundary. Allocate identities with the locked head and preserve supplied inline anchors. */
import {canonicalizeHtmlPage,canonicalizeHtmlSource,type CanonicalHtmlOptions,type HtmlPageAnalysis} from '../html-page';
import {attribute,parseSource} from '../html-page/html-source';
import {convertLegacyPage} from '../live-regions';

export function normalizeNewHtmlPage(source:string,options:CanonicalHtmlOptions={},analysis?:HtmlPageAnalysis) {
 const {canonical,shape,recovered,indexIds}=analysis?.source===source?analysis.forStorage(options):canonicalizeHtmlSource(source,{...options,preserveInlineIds:true});
 const legacy=[...shape.elements,...shape.templateElements].some(element=>{
  const kind=attribute(element,'data-af-editable');
  return kind==='rich'||kind==='text';
 });
 // The lossless converter uses the final ID-bearing bytes. Legacy template regions are not converted and
 // still omit inline IDs in the source index. Recovered markup likewise needs the exact stored-source check.
 const html=legacy?convertLegacyPage(canonical.html).html:canonical.html;
 return {
  ...canonical,html,
  shape:html===canonical.html?shape:parseSource(html),
  indexIds:()=>legacy||recovered||html.length>4_000_000?canonicalizeHtmlPage(html).nodeIds:indexIds(),
 };
}
