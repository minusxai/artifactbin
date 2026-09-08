import type {ReactNode} from 'react';
import {renderToString} from 'react-dom/server';
import {StaticRouter} from 'react-router';
import Landing from '@/components/Landing';
import LegalDocument from '@/components/LegalDocument';
import DocsHuman from '@/components/DocsHuman';
import {ProfileListing,type ProfileListingData} from '@/components/ProfileListing';
import {AppBar} from '@/components/PageChrome';
import {PAGE_COLUMN} from '@/components/ui';
import {escapeHtml} from '@/lib/story/reader-chrome';
import type {PageBootstrap} from '@/web/page-bootstrap-contract';
import {HomeView,type Home} from '@/web/pages/Home';
import {PageStatus} from '@/web/PageStatus';
import {FolderPage,type FolderPageProps} from '@/web/pages/Folder';

/** One server presentation boundary. Data has already passed the page APIs'
 * ACLs. `ssr` describes a rendered route body, never permission or a promise. */
export function directPageHtml(template:string,data:PageBootstrap,main:string,dynamicSsr:boolean,status:number,social?:{title:string;description:string|null;image:string}):{html:string;data:PageBootstrap} {
  const profile=data.profile as ProfileListingData|undefined;
  const artifact=data.artifact as ({canonical?:string;surface?:{title?:string|null;fontPreloads?:string[]}}&Partial<FolderPageProps>)|undefined;
  const names:Record<string,string>={'/account':'account','/login':'login','/chat':'remote sessions','/tokens/new':'new token','/tokens':'account','/trash':'trash','/assets':'assets','/datasets/new':'dataset editor','/docs-human':'human docs','/privacy':'privacy','/terms':'terms'};
  const name=data.presentation==='workspace'?'workspace':data.presentation==='artifact'?'artifact':data.presentation==='profile'?'profile':names[data.path]??(data.path.startsWith('/datasets/')?'dataset editor':'page');
  let body:ReactNode=<PageStatus label={name}/>;
  let rendered=false;
  if(status===404){body=<main className={`${PAGE_COLUMN} mt-8`}><h1>Not found</h1><p>This page is missing or unavailable.</p></main>;rendered=true;}
  else if(data.path==='/' && data.presentation==='public'){body=<Landing/>;rendered=true;}
  else if(data.path==='/privacy'||data.path==='/terms'){body=<LegalDocument slug={data.path.slice(1) as 'privacy'|'terms'}/>;rendered=true;}
  else if(data.path==='/docs-human'){body=<DocsHuman/>;rendered=true;}
  else if(dynamicSsr && profile && data.presentation==='profile'){
    body=<main className={`${PAGE_COLUMN} mt-8 pb-24`}><ProfileListing data={profile}/></main>;rendered=true;
  } else if(dynamicSsr && artifact?.folder && artifact.role){
    body=<FolderPage folder={artifact.folder} role={artifact.role} workspace={artifact.workspace} ownerUsername={artifact.ownerUsername} liveEnabled={artifact.liveEnabled}/>;rendered=true;
  } else if(dynamicSsr && data.path==='/' && data.home){
    body=<HomeView home={data.home as Home} session={data.session}/>;rendered=true;
  }
  const title=status===404?'Not found · artifactbin':social?`${social.title} · artifactbin`:artifact?.surface?.title?`${artifact.surface.title} · artifactbin`:profile?.handle?`@${profile.handle} · artifactbin`:data.path==='/'?'artifactbin · Interactive documents for agents':`${name[0].toUpperCase()+name.slice(1)} · artifactbin`;
  const description=social?.description??(profile?.handle?`Public artifacts by @${profile.handle}.`:'Your agents publish interactive HTML documents you can edit, annotate and share.');
  const canonical=main+(artifact?.canonical??data.path);
  const markup=renderToString(<StaticRouter location={data.path}><div inert aria-hidden="true"><AppBar title={social?.title}/></div>{body}</StaticRouter>);
  const socialTags=social?`<meta property="og:title" content="${escapeHtml(social.title)}">${social.description?`<meta property="og:description" content="${escapeHtml(social.description)}">`:''}<meta property="og:image" content="${escapeHtml(social.image)}">`:'';
  const help=template.includes('rel="help"')?'':`<link rel="help" href="${escapeHtml(main+'/docs')}" title="Agents: read this first to edit any artifact here"><meta name="artifactbin:agent" content="To edit this artifact, read ${escapeHtml(main+'/docs')} — tokens at ${escapeHtml(main+'/tokens/new')}">`;
  // The admitted page payload has already resolved critical font assets. Start
  // those requests before client mounting; never derive URLs from author DOM.
  const fonts=status===200?[...new Set(artifact?.surface?.fontPreloads??[])].map(href=>`<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="${escapeHtml(href)}">`).join(''):'';
  const html=template.replace(/<title>[\s\S]*?<\/title>/g,'').replace(/<meta name="description"[^>]*>/g,'').replace(/<link rel="canonical"[^>]*>/g,'')
    .replace('</head>',()=>`<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}">${socialTags}${help}${fonts}</head>`)
    .replace('<div id="root"></div>',()=>`<div id="root">${markup}</div>`);
  return {html,data:{...data,ssr:rendered}};
}
