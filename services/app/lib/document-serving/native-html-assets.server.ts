import {pinPublicationAssetUrls} from '@/lib/html-publication-bundle';
import {htmlAssetLinks,rewriteHtmlAssetUrls} from '@/lib/html-page';
import {getArtifactHeadersByIds,type ArtifactRow} from '@/lib/artifacts';
import {lookupWebAssets} from '@/lib/publish';
import {editableRegions} from '@/lib/live-regions';
/** The external images a document's text (its rich-native-v1 regions) names; read only when the page has such a region. */
const documentImages=(source:string):string[]=>source.includes('rich-native-v1')
 ?editableRegions(source).filter(region=>region.kind==='rich-native-v1').flatMap(region=>htmlAssetLinks(region.inner).imageUrls.filter(url=>url.startsWith('https://'))):[];
/** Published references carry admission only; each eventual byte request still enforces its current read ACL.
 * `captureKey`: an export capture's verified key, carried on the page's own-door addresses (./native-html.server).
 * An external image in a document's text that no cached copy serves yet goes through the page's first-view door
 * (`/a/<id>/assets?u=`, app/a/[id]/assets: the reader's access, the network guard, image bytes only, the page's hourly
 * allowance), so the reader's browser never fetches what an agent wrote there from its own host. */
export async function nativeHtmlAssets(row:Pick<ArtifactRow,'id'|'version'|'source'|'meta'>,captureKey:string|null=null):Promise<string>{
 const source=row.source??'',assets=htmlAssetLinks(source),urls=new Map<string,string>();
 const admitted=(row.meta as {refs?:Array<{id:string}>}).refs??[];
 // One header read for every admitted reference: the format and version are all a raw address needs.
 const [headers, images] = await Promise.all([
  getArtifactHeadersByIds(assets.refs.filter(id=>admitted.some(ref=>ref.id===id))),
  lookupWebAssets(assets.imageUrls),
 ]);
 for(const asset of headers)if(['image','file','pdf'].includes(asset.format))urls.set('ref:'+asset.id,`/a/${asset.id}/raw?v=${asset.version}`);
 for(const [url,asset] of images)urls.set(url,`/assets/${asset.url_hash}`);
 if(assets.imageUrls.some(url=>url.startsWith('https://')&&!images.has(url)))for(const url of documentImages(source))if(!urls.has(url))urls.set(url,`/a/${row.id}/assets?u=${encodeURIComponent(url)}${captureKey?`&key=${encodeURIComponent(captureKey)}`:''}`);
 return pinPublicationAssetUrls(rewriteHtmlAssetUrls(source,urls),row.id,row.version,'text/html',[],captureKey);
}
