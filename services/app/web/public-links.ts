import {appUrl} from './api-origin';

/** Native hrefs must work for modifier clicks and new tabs, not only our click handler. */
export function rewritePublicLinks(): void {
  for(const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')){
    const before=anchor.getAttribute('href')!;
    const after=appUrl(before);
    if(after!==before)anchor.setAttribute('href',after);
  }
}
