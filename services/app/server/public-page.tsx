import {renderToString} from 'react-dom/server';
import {StaticRouter} from 'react-router';
import {PublicPage} from '@/web/PublicPage';
import type {PublicPageData} from '@/web/public-page-contract';
import {escapeHtml} from '@/lib/story/reader-chrome';

/** The serializer owns metadata and only accepts a public projection, not a session. */
export function publicPageHtml(template:string,data:PublicPageData,main:string) {
  const title=data.profile?`@${data.profile.handle} · artifactbin`:data.path==='/privacy'?'Privacy · artifactbin':data.path==='/terms'?'Terms · artifactbin':'artifactbin · Interactive documents for agents';
  const description=data.profile?`Public artifacts by @${data.profile.handle}.`:'Your agents publish interactive HTML documents you can edit, annotate and share.';
  const json=JSON.stringify(data).replace(/</g,'\\u003c');
  const body=renderToString(<StaticRouter location={data.path}><PublicPage data={data}/></StaticRouter>);
  return template.replace(/<title>[\s\S]*?<\/title>/,'').replace(/<meta name="description"[^>]*>/,'')
    .replace('</head>',()=>`<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(main+data.path)}"><script type="application/json" id="mx-public-page">${json}</script></head>`)
    .replace('<div id="root"></div>',()=>`<div id="root">${body}</div>`);
}
