import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import Landing from '@/components/Landing';
import PageChrome from '@/components/PageChrome';

/** The same public content and chrome as React, retained until Home commits. */
export function withInitialHome(html: string): string {
  const body = renderToStaticMarkup(<StaticRouter location="/"><PageChrome authed={false} /><Landing /></StaticRouter>);
  return html.replace('</body>', () => `<div data-mx-initial-home=""><style>body > #root:first-child{display:none!important}</style>${body}</div></body>`);
}
