import {render,waitFor} from '@testing-library/react';
import {it,expect} from 'vitest';
import {StoryRuntimeApp} from '../StoryRuntimeApp';
import {parseJsx} from '@/lib/jsx';
import {STORY_UI_COMPONENTS} from '@/lib/story-ui/registry';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
it('reserves managed frame dimensions in the inert SSR registry',()=>{
  const html=renderToStaticMarkup(createElement(STORY_UI_COMPONENTS.Iframe,{title:'Demo',height:450,compiled:{html:'<p>secret</p>',scripts:[]}}));
  expect(html).toContain('height:450px');expect(html).toContain('aria-label="Demo"');expect(html).not.toContain('secret');
});
it('renders separate managed regions without author DOM in the parent',async()=>{
  const parsed=parseJsx('<Iframe title="One"><p>Inner</p><script>{`void 0`}</script></Iframe><Iframe title="Two"><canvas/></Iframe>');
  if(!parsed.ok)throw Error(parsed.error);
  const view=render(<StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light"/>);
  await waitFor(()=>expect(view.container.querySelectorAll('iframe')).toHaveLength(2));
  expect(view.container.querySelector('canvas,script')).toBeNull();
  expect(view.container.textContent).not.toContain('Inner');view.unmount();
});
