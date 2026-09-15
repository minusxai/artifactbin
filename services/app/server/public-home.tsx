import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import Landing from '@/components/Landing';
import { WORKSHOP_PAPERS, WORKSHOP_SETTINGS } from '@/components/living-workshop/scene-manifest';
import { WORKSHOP_ROBOTS, WORKSHOP_ARM_URL, workshopRobotUrl, workshopBadgeUrl, workshopPosterUrl } from '@/components/living-workshop/workshop-assets';
import { escapeHtml } from '@/lib/story/reader-chrome';

/** The same public content and chrome as React, retained until Home commits. */
export function withInitialHome(html: string, development = false): string {
  const preload = (href: string, as: "image" | "fetch", cors = false) => `<link rel="preload" href="${escapeHtml(href)}" as="${as}"${cors ? ' crossorigin="anonymous"' : ''} fetchpriority="low">`;
  // Local scene assets go first so export requests cannot occupy every dev connection.
  const assets = [
    preload(WORKSHOP_SETTINGS.indoor.mask, "image"),
    ...WORKSHOP_ROBOTS.map(robot => preload(workshopBadgeUrl(robot.agent), "image", true)),
    ...WORKSHOP_ROBOTS.map(robot => preload(workshopRobotUrl(robot.role), "fetch", true)),
    preload(WORKSHOP_ARM_URL, "fetch", true),
    // Dev exports share the app’s HTTP/1 connection pool. Warm two, leaving
    // connections free for JavaScript; production exports use a separate origin.
    ...(development ? WORKSHOP_PAPERS.slice(0, 2) : WORKSHOP_PAPERS).map(paper => preload(workshopPosterUrl(paper.image, development), "image", true)),
  ].join('');
  html = html.replace('</head>', () => assets + '</head>');
  const body = renderToStaticMarkup(<StaticRouter location="/"><Landing /></StaticRouter>);
  // A static button cannot honor a gesture. Native disabled inheritance keeps
  // every shared form control unavailable until React replaces the sibling,
  // while ordinary links and readable content remain useful without scripts.
  return html.replace('</body>', () => `<div data-mx-initial-home=""><style>body > #root:first-child{display:none!important}</style><fieldset disabled aria-busy="true" style="border:0;margin:0;padding:0;min-width:0">${body}</fieldset></div></body>`);
}
