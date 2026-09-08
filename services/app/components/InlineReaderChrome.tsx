import type { ReactNode } from 'react';
import { renderReaderChrome, READER_CHROME_HIDDEN_CLASS, type ReaderChromeInput } from '@/lib/story/reader-chrome';
import { STORY_CHROME_CSS } from '@/lib/story-runtime/chrome-css';

/** Identical desktop/mobile reader layout, with local handlers inside TrustedUi. */
export function InlineReaderChrome({ input, onAction }: { input: ReaderChromeInput; onAction(action:string):void }): ReactNode {
  const html = renderReaderChrome(input).replace(READER_CHROME_HIDDEN_CLASS, '').replace('data-mx-reader-state="hidden"', 'data-mx-reader-state="shown"');
  return <>
    <style>{STORY_CHROME_CSS}</style>
    <div onClick={event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-mx-reader-action],[data-mx-reader-trigger]');
      if (!target) return;
      event.preventDefault();
      onAction(target.getAttribute('data-mx-reader-action') ?? target.getAttribute('data-mx-reader-trigger') ?? '');
    }} dangerouslySetInnerHTML={{__html:html}} />
  </>;
}
