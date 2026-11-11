import {pinPublicationAssetUrls} from '@/lib/html-publication-bundle';
import {htmlAssetLinks,rewriteHtmlAssetUrls} from '@/lib/html-page';
import {getArtifactHeadersByIds,type ArtifactRow} from '@/lib/artifacts';
import {lookupWebAssets} from '@/lib/publish';
/** Published references carry admission only; each eventual byte request still enforces its current read ACL.
 * `captureKey`: an export capture's verified key, carried on the page's own-door addresses (./native-html.server). */
export async function nativeHtmlAssets(row:Pick<ArtifactRow,'id'|'version'|'source'|'meta'>,captureKey:string|null=null):Promise<string>{
 const source=row.source??'',assets=htmlAssetLinks(source),urls=new Map<string,string>();
 const admitted=(row.meta as {refs?:Array<{id:string}>}).refs??[];
 // One header read for every admitted reference: the format and version are all a raw address needs.
 for(const asset of await getArtifactHeadersByIds(assets.refs.filter(id=>admitted.some(ref=>ref.id===id))))if(['image','file','pdf'].includes(asset.format))urls.set('ref:'+asset.id,`/a/${asset.id}/raw?v=${asset.version}`);
 for(const [url,asset] of await lookupWebAssets(assets.imageUrls))urls.set(url,`/assets/${asset.url_hash}`);
 return pinPublicationAssetUrls(rewriteHtmlAssetUrls(source,urls),row.id,row.version,'text/html',[],captureKey);
}
