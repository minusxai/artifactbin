import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InlineStoryRuntime, type InlineStoryController } from '../InlineStoryRuntime';
import { STORY_ANNOTATIONS_MESSAGE } from '../contract';

vi.mock('../edit/annotate', () => { throw new Error('Annotation chunk unavailable'); });
afterEach(async () => { cleanup(); await vi.dynamicImportSettled(); vi.restoreAllMocks(); });

it('reports an active lazy-module failure without an unhandled rejection', async () => {
  const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  let controller:InlineStoryController|null=null;
  render(<InlineStoryRuntime data={{nodes:[],refData:{},colorMode:'light',chrome:false}} onController={value=>{controller=value;}} />);
  await act(async()=>{
    controller!.send({type:STORY_ANNOTATIONS_MESSAGE,mode:'on',pins:[],open:null});
    await vi.dynamicImportSettled();
  });
  expect(error).toHaveBeenCalledWith('Failed to load artifact annotations',expect.any(Error));
});
it('revokes pending imports on disposal without reporting into the next document', async () => {
  const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  let controller:InlineStoryController|null=null;
  const view=render(<InlineStoryRuntime data={{nodes:[],refData:{},colorMode:'light',chrome:false}} onController={value=>{controller=value;}} />);
  controller!.send({type:STORY_ANNOTATIONS_MESSAGE,mode:'on',pins:[],open:null});
  view.unmount();
  await vi.dynamicImportSettled();
  expect(error).not.toHaveBeenCalled();
});
