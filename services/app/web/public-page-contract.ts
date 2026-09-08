/** Public presentation only. Account state never crosses this contract. */
import {trustedRegionRoute,type PublicPath,type TrustedRegionKind} from '@artifactbin/utils/platform-pages';
export {publicPagePath,trustedRegionRoute,type PublicPath,type TrustedRegionKind} from '@artifactbin/utils/platform-pages';
/** Bootstrap text is data: only a canonical HTTP(S) origin can host controls. */
export function trustedRegionAddress(controls:string,kind:TrustedRegionKind,page:PublicPath,search:string):URL|null {
  try{
    const url=new URL(controls);
    if((url.protocol!=='https:'&&url.protocol!=='http:') || url.origin!==controls || url.username || url.password)return null;
    const path='/controls/region/'+encodeURIComponent(kind);
    if(!trustedRegionRoute(path,page))return null;
    url.pathname=path;url.searchParams.set('page',page);url.searchParams.set('search',search);
    return url;
  }catch{return null;}
}
export interface PublicProfileData {
  handle: string;
  files: Array<Record<string, unknown> & {id: string; format: string}>;
}
export interface PublicPageData {
  path: PublicPath;
  controls: string;
  search?:string;
  profile?: PublicProfileData;
}
