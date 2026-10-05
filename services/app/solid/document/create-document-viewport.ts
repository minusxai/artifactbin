/** Reserve the shared bars and desktop comment rail around an in-document surface. */
import { createEffect, onCleanup, onMount } from 'solid-js';
import { createIsPhoneViewport } from '../components/MobileSheet';
import { EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story/reader/edit-bar';

export function createDocumentViewport(input: { barHeight: () => number; editing: () => boolean; commentsOpen: () => boolean }): void {
  const phone = createIsPhoneViewport();
  onMount(() => {
    const body = document.body;
    const padding = body.style.paddingTop;
    const margin = body.style.marginRight;
    createEffect(() => {
      body.style.paddingTop = `${input.barHeight() + (input.editing() ? EDIT_BAR_H : 0)}px`;
      body.style.marginRight = input.commentsOpen() && !phone() ? `${RIGHT_RAIL_W}px` : margin;
    });
    onCleanup(() => { body.style.paddingTop = padding; body.style.marginRight = margin; });
  });
}
