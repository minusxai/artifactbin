/**
 * A MENU PANEL MUST ESCAPE ITS TRIGGER'S BOX, AND THAT IS STRUCTURAL.
 *
 * The edit toolbar's left group is a scroller (`overflow-x-auto`, so the
 * controls can slide on a phone while `done` stays put). CSS turns the other
 * axis into `auto` with it, which makes that group a ~26px-tall clip box in
 * BOTH directions — and an `absolute top-full` panel opens below those 26px,
 * into the clip. `z-index` does not escape a clip, so the theme grid and the
 * mode list rendered with a real bounding box, painted nothing, and let every
 * click fall through to the document iframe underneath.
 *
 * The fix is the one SelectMenu already documents: PORTAL the panel. jsdom
 * models no layout, so clipping itself is a browser gate's question
 * (scripts/gate-mobile.mjs hit-tests the open panel). What jsdom CAN pin is the
 * thing that makes clipping impossible in the first place — the panel is a
 * child of <body>, not of whatever box the trigger sits in. That is the
 * contract; the geometry follows from it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AnchoredPanel from '../AnchoredPanel';
import ThemePicker, { ModeChip } from '../ThemePicker';

/** The toolbar's own shape: a clipping scroller around the trigger. */
const Clipped = ({ children }: { children: React.ReactNode }) => (
  <div data-testid="clip" className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
    {children}
  </div>
);

/** Did `label`'s panel land outside the clipping box — i.e. was it portalled? */
const escapedTheClip = (label: string): boolean => {
  const panel = screen.getByLabelText(label);
  const clip = screen.getByTestId('clip');
  return !clip.contains(panel) && document.body.contains(panel);
};

beforeEach(() => {
  // Desktop: the phone path is a MobileSheet, which portals already.
  window.innerWidth = 1400;
});
afterEach(cleanup);

describe('AnchoredPanel', () => {
  it('renders nothing while closed', () => {
    render(
      <Clipped>
        <AnchoredPanel label="Options" open={false} onOpenChange={() => {}} trigger={<button type="button" aria-label="Open">open</button>}>
          <button type="button" aria-label="An option">an option</button>
        </AnchoredPanel>
      </Clipped>,
    );
    expect(screen.queryByLabelText('Options')).toBeNull();
    expect(screen.getByLabelText('Open')).toBeTruthy();
  });

  it('portals the open panel out of a clipping ancestor', () => {
    render(
      <Clipped>
        <AnchoredPanel label="Options" open onOpenChange={() => {}} trigger={<button type="button" aria-label="Open">open</button>}>
          <button type="button" aria-label="An option">an option</button>
        </AnchoredPanel>
      </Clipped>,
    );
    expect(screen.getByLabelText('An option')).toBeTruthy();
    expect(escapedTheClip('Options')).toBe(true);
  });

  it('reports a dismissal so the caller stays the one holding `open`', () => {
    const onOpenChange = vi.fn();
    render(
      <Clipped>
        <AnchoredPanel label="Options" open onOpenChange={onOpenChange} trigger={<button type="button" aria-label="Open">open</button>}>
          <button type="button" aria-label="An option">an option</button>
        </AnchoredPanel>
      </Clipped>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('on a phone it is a bottom sheet — which is a portal too', () => {
    window.innerWidth = 500;
    render(
      <Clipped>
        <AnchoredPanel label="Options" open onOpenChange={() => {}} trigger={<button type="button" aria-label="Open">open</button>}>
          <button type="button" aria-label="An option">an option</button>
        </AnchoredPanel>
      </Clipped>,
    );
    expect(escapedTheClip('Options')).toBe(true);
    expect(screen.getByLabelText('Options').getAttribute('role')).toBe('dialog');
  });
});

/*
 * The two panels the bug was actually reported against. Their props do not
 * change — only where their markup lands.
 */
describe('the edit toolbar controls escape the toolbar scroller', () => {
  it('the theme grid is portalled', () => {
    render(
      <Clipped>
        <ThemePicker value="modernist" colorMode={null} onPick={() => {}} />
      </Clipped>,
    );
    fireEvent.click(screen.getByLabelText('Theme'));
    expect(escapedTheClip('Themes')).toBe(true);
    expect(screen.getByLabelText('Theme terminal')).toBeTruthy();
  });

  it('the colour-mode list is portalled', () => {
    render(
      <Clipped>
        <ModeChip mode={null} themeDefault="light" onPick={() => {}} />
      </Clipped>,
    );
    fireEvent.click(screen.getByLabelText('Color mode'));
    expect(escapedTheClip('Color modes')).toBe(true);
    expect(screen.getByLabelText('Color mode dark')).toBeTruthy();
  });

  it('a pick still reaches the caller from inside the portal', () => {
    const onPick = vi.fn();
    render(
      <Clipped>
        <ThemePicker value="modernist" colorMode={null} onPick={onPick} />
      </Clipped>,
    );
    fireEvent.click(screen.getByLabelText('Theme'));
    fireEvent.click(screen.getByLabelText('Theme terminal'));
    expect(onPick).toHaveBeenCalledWith('terminal');
  });
});
