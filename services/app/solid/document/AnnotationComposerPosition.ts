import type { StoryEditSelection } from '@/lib/story-runtime/contract';
import { APP_BAR_H } from '@/lib/story-ui/edit-bar';

/** Frame-relative selections stay beside their document node and clear the rail. */
export function positionedComposer(selection: StoryEditSelection, frame: Pick<DOMRect, 'left' | 'top' | 'width'>,
  viewportWidth: number, viewportHeight: number, screenshot = false) {
  const inset = 12;
  const narrow = frame.width < 280;
  const minLeft = narrow ? inset : frame.left + inset;
  const maxRight = narrow ? viewportWidth - inset : Math.min(viewportWidth - inset, frame.left + frame.width - inset);
  const width = Math.max(0, Math.min(screenshot ? 680 : 384, maxRight - minLeft));
  const anchorRight = frame.left + selection.rect.x + selection.rect.width;
  const left = Math.max(minLeft, Math.min(anchorRight + 12, maxRight - width));
  const minTop = Math.max(frame.top, screenshot ? APP_BAR_H : 0) + inset;
  const preferredTop = frame.top + selection.rect.y + Math.min(selection.rect.height + 12, 56);
  const maxTop = Math.max(minTop, viewportHeight - (screenshot ? 720 : 236) - inset);
  return { left, top: Math.max(minTop, Math.min(preferredTop, maxTop)), width };
}
