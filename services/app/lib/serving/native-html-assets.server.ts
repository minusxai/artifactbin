import {pinPublicationAssetUrls} from '@/lib/html-publication-bundle';
import {htmlAssetLinks,rewriteHtmlAssetUrls} from '@/lib/html-page';
import {getArtifactById,type ArtifactRow} from '@/lib/artifacts';
import {lookupWebAssets} from '@/lib/publish/assets/web-assets';
/** Published references carry admission only; each eventual byte request still enforces its current read ACL. */
export async function nativeHtmlAssets(row:Pick<ArtifactRow,'id'|'version'|'source'|'meta'>):Promise<string>{
 const source=row.source??'',assets=htmlAssetLinks(source),urls=new Map<string,string>();
 const admitted=(row.meta as {refs?:Array<{id:string}>}).refs??[];
 await Promise.all(assets.refs.filter(id=>admitted.some(ref=>ref.id===id)).map(async id=>{const asset=await getArtifactById(id);if(asset&&['image','file','pdf'].includes(asset.format))urls.set('ref:'+id,`/a/${id}/raw?v=${asset.version}`);}));
 for(const [url,asset] of await lookupWebAssets(assets.imageUrls))urls.set(url,`/assets/${asset.url_hash}`);
 return pinPublicationAssetUrls(rewriteHtmlAssetUrls(source,urls),row.id,row.version);
}
