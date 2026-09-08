import type {ReactNode} from 'react';
import {ListingHero,NothingHere} from './Listing';
import Shelf from './Shelf';
import {canonicalArtifactPath} from '@/lib/urls';
import type {PublicProfileData} from '@/web/public-page-contract';

export interface ProfileListingData extends PublicProfileData {
  owner?:{id:string};
  follow?:{following:boolean;count:number};
  authed?:boolean;
}
/** Same public projection on server, profile client and trusted Follow region. */
export function ProfileListing({data,followSlot}:{data:ProfileListingData;followSlot?:ReactNode}) {
  return <>
    <ListingHero handle={data.handle} label="public index"
      count={data.files.filter(a=>a.format==='markup'||a.format==='folder').length} noun="public artifact"
      followSlot={followSlot}
      {...(data.owner&&data.follow?{follow:{userId:data.owner.id,...data.follow,signedIn:!!data.authed}}:{})}/>
    {data.files.length===0?<NothingHere/>:<Shelf actions="share" showVisibility={false} assets={false} dates="absolute"
      rows={data.files.map(a=>({...a,url:canonicalArtifactPath(a as never,data.handle)}) as never)}/>}
  </>;
}
