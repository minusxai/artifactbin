import {useState} from 'react';
import Landing from '@/components/Landing';
import GetStarted from '@/components/GetStarted';
import PageChrome from '@/components/PageChrome';
import LegalDocument from '@/components/LegalDocument';
import {ProfileListing} from '@/components/ProfileListing';
import {TrustedRegion} from '@/components/TrustedRegion';
import {PAGE_COLUMN} from '@/components/ui';
import type {PublicPageData} from './public-page-contract';

/** Public HTML and harmless local interactions only; no SessionProvider here. */
export function PublicPage({data}:{data:PublicPageData}) {
  const [workspace,setWorkspace]=useState(false);
  return <>
    <TrustedRegion kind="chrome" page={data.path} search={data.search} controls={data.controls} fallback={<PageChrome authed={false}/>}/>
    {data.path==='/'?<Landing workspace={workspace} start={<TrustedRegion kind="home" page="/" search={data.search} controls={data.controls} fallback={<GetStarted/>} onWorkspace={setWorkspace}/>}/>:
      data.profile?<main className={`${PAGE_COLUMN} pt-10 pb-24`}><ProfileListing data={data.profile} followSlot={
        <TrustedRegion kind="follow" page={data.path} search={data.search} controls={data.controls} fallback={<button disabled className="rounded-full border border-edge px-3 py-1 font-mono text-xs text-muted">follow</button>}/>
      }/></main>:
      data.path==='/privacy'||data.path==='/terms'?<LegalDocument slug={data.path.slice(1) as 'privacy'|'terms'}/>:null}
  </>;
}
