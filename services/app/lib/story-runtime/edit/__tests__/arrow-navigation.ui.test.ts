/**
 * ARROWS ACROSS TEXT REGIONS (lib/story-runtime/edit/arrow-navigation): the decision, with the
 * layout faked behind `RegionGeometry`. A caret on a region's edge line moves on to the next
 * region; anywhere else the key stays with the browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTextRegions, navigateAcrossRegions, type RegionGeometry, type TextRegion } from '../arrow-navigation';

afterEach(() => { document.body.innerHTML = ''; });

function setup() {
  document.body.innerHTML = '<div id="scope"><p data-mx-ast="0" contenteditable="true">First line</p>'
    + '<nav class="mx-rail"><p data-mx-ast="9" contenteditable="true">Rail copy</p></nav>'
    + '<p data-mx-ast="1" contenteditable="true">Second region</p></div>';
  const scope = document.getElementById('scope')!;
  const regions = collectTextRegions(scope, []);
  const [first, second] = regions as [TextRegion, TextRegion];
  const caret = document.createRange();
  caret.setStart(first.el.firstChild!, 3);
  caret.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(caret);
  return { regions, first, second };
}

const geometry = (atEdge: boolean) => ({
  visible: () => true,
  atEdge: () => atEdge,
  caretX: () => 42,
  enter: vi.fn<RegionGeometry['enter']>(),
}) satisfies RegionGeometry;

const arrow = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

describe('navigateAcrossRegions', () => {
  it('collects the editable regions in reading order, without the document chrome copies', () => {
    const { regions } = setup();
    expect(regions.map((region) => region.el.getAttribute('data-mx-ast'))).toEqual(['0', '1']);
  });

  it('ArrowDown on the last line moves the caret into the next region and takes the key', () => {
    const { regions, first, second } = setup();
    const g = geometry(true);
    const event = arrow(first.el, 'ArrowDown');
    expect(navigateAcrossRegions(event, { regions, selection: window.getSelection(), geometry: g })).toBe(true);
    expect(g.enter).toHaveBeenCalledWith(second, 'down', 42);
    expect(event.defaultPrevented).toBe(true);
  });

  it('mid-region the key stays with the browser', () => {
    const { regions, first } = setup();
    const g = geometry(false);
    const event = arrow(first.el, 'ArrowDown');
    expect(navigateAcrossRegions(event, { regions, selection: window.getSelection(), geometry: g })).toBe(false);
    expect(g.enter).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('past the last region, a Shift selection, or an ArrowUp at the top go nowhere', () => {
    const { regions, first, second } = setup();
    const g = geometry(true);
    expect(navigateAcrossRegions(arrow(first.el, 'ArrowDown', { shiftKey: true }), { regions, selection: window.getSelection(), geometry: g })).toBe(false);
    expect(navigateAcrossRegions(arrow(first.el, 'ArrowUp'), { regions, selection: window.getSelection(), geometry: g })).toBe(false);
    const caret = document.createRange();
    caret.setStart(second.el.firstChild!, 1);
    caret.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(caret);
    expect(navigateAcrossRegions(arrow(second.el, 'ArrowDown'), { regions, selection: window.getSelection(), geometry: g })).toBe(false);
    expect(g.enter).not.toHaveBeenCalled();
  });
});
