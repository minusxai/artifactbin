/** Public presentation only. Account state never crosses this contract. */
import type {PublicPath} from '@artifactbin/utils/platform-pages';
export {publicPagePath,trustedRegionRoute,type PublicPath,type TrustedRegionKind} from '@artifactbin/utils/platform-pages';
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
