/** Permanent new-head boundary. Allocate fresh identities without stripping supplied anchors,
 * then use the strict, lossless legacy converter. Historical reads never call this helper.
 */
import {canonicalizeHtmlPage,type CanonicalHtmlOptions} from '../html-page';
import {convertLegacyPage} from '../live-regions';
export function normalizeNewHtmlPage(source:string,options:CanonicalHtmlOptions={}):ReturnType<typeof canonicalizeHtmlPage> {
 const page=canonicalizeHtmlPage(source,{...options,preserveInlineIds:true});
 return {...page,html:convertLegacyPage(page.html).html};
}
