/**
 * A FILE DROPPED ON A FRAMED DOCUMENT (lib/islands/frame-file-drops): an unclaimed file drag is refused so the frame
 * never opens the file in the document's place; whatever claims a drop first (the editor, an author's drop zone,
 * a native file input) still gets it, a text drag is untouched, and so is the reader's selection.
 */
import { afterEach, expect, it } from 'vitest';
import { refuseFileNavigation } from '../frame-file-drops';

const transfer = (types: string[]) => ({ types, files: [], dropEffect: 'move' }) as unknown as DataTransfer;
const drag = (target: EventTarget, type: 'dragover' | 'drop', types = ['Files']) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: transfer(types) });
  target.dispatchEvent(event);
  return event;
};

let stop = () => {};
afterEach(() => { stop(); document.body.innerHTML = ''; });

it('refuses an unclaimed file drag anywhere in the document and leaves the selection alone', () => {
  document.body.innerHTML = '<p id="words">Revenue grew 40% in Q3.</p>';
  const words = document.getElementById('words')!;
  const range = document.createRange(); range.selectNodeContents(words);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  const before = drag(words, 'dragover'), dropped = drag(words, 'drop');
  expect([before.defaultPrevented, dropped.defaultPrevented]).toEqual([false, false]);
  stop = refuseFileNavigation(window);
  const over = drag(words, 'dragover'), drop = drag(words, 'drop');
  expect(over.defaultPrevented).toBe(true);
  expect(over.dataTransfer!.dropEffect).toBe('none');
  expect(drop.defaultPrevented).toBe(true);
  expect(window.getSelection()!.toString()).toBe('Revenue grew 40% in Q3.');
});

it('leaves a text drag, a native file input and a drop someone already claimed to their owners', () => {
  document.body.innerHTML = '<p id="words">words</p><label>File<input id="file" type="file"></label><div id="zone"></div>';
  stop = refuseFileNavigation(window);
  expect(drag(document.getElementById('words')!, 'drop', ['text/plain']).defaultPrevented).toBe(false);
  expect(drag(document.getElementById('file')!, 'drop').defaultPrevented).toBe(false);
  const zone = document.getElementById('zone')!;
  let claimed = 0;
  zone.addEventListener('drop', (event) => { event.preventDefault(); claimed += 1; });
  expect(drag(zone, 'drop').defaultPrevented).toBe(true);
  expect(claimed).toBe(1);
  stop(); stop = () => {};
  expect(drag(document.getElementById('words')!, 'drop').defaultPrevented).toBe(false);
});
