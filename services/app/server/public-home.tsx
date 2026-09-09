import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import Landing from '@/components/Landing';
import PageChrome from '@/components/PageChrome';

/** The same public content and chrome as React, retained until Home commits. */
export function withInitialHome(html: string): string {
  const body = renderToStaticMarkup(<StaticRouter location="/"><PageChrome authed={false} /><Landing /></StaticRouter>);
  // A static button cannot honor a gesture. Native disabled inheritance keeps
  // every shared form control unavailable until React replaces the sibling,
  // while ordinary links and readable content remain useful without scripts.
  return html.replace('</body>', () => `<div data-mx-initial-home=""><style>body > #root:first-child{display:none!important}</style><fieldset disabled aria-busy="true" style="border:0;margin:0;padding:0;min-width:0">${body}</fieldset></div></body>`);
}
