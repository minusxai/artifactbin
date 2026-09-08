import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TrustedUi } from '../TrustedUi';
import StoryFormatToolbar from '../views/story/StoryFormatToolbar';
import ShareLink from '../ShareLink';
afterEach(() => vi.unstubAllGlobals());

it('keeps the actual format toolbar inside its trusted root', async () => {
  const view = render(<TrustedUi overlay><StoryFormatToolbar selection={{kind:'element',path:'0',tag:'div',rect:{x:0,y:100,width:200,height:60},className:'',style:'',ancestors:[]}} onApply={vi.fn()} onApplyLink={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()} /></TrustedUi>);
  const shadow = view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
  await waitFor(() => expect(shadow.querySelector('[aria-label="Typography toolbar"]')).not.toBeNull());
  expect(document.querySelector('[aria-label="Typography toolbar"]')).toBeNull();
});

it('keeps the actual sharing dialog inside its trusted root', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({visibility:'public',shares:[],link_role:'viewer'}))));
  const view = render(<TrustedUi overlay><ShareLink className="" artifactId="Ab3xK9" owner /></TrustedUi>);
  const shadow = view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
  const button = shadow.querySelector('[aria-label="Share"]') ?? shadow.querySelector('button');
  expect(button).not.toBeNull();
  fireEvent.click(button!);
  await waitFor(() => expect(shadow.querySelector('[role="dialog"]')).not.toBeNull());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
