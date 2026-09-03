/**
 * B1 — the framed document's scroll samples drive the phone bar (SEEDED RED by the orchestrator).
 *
 * The artifact page never scrolls itself; the document inside the frame does, and
 * relays samples. Two defects hid in that relay: the bar's baseline was seeded from
 * the PARENT's scrollY (always 0) and compared against FRAME offsets, so the first
 * sample after a reload could hide the bar from a standstill; and the frame never
 * said "I am at my end", so the end-of-page rule (the bar stays up where there is
 * nothing further to scroll to) was lost for every framed document.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { notifyPageChromeScroll, PageChromeBar, PageControls, PageMenu } from '@/components/PageChrome';

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

afterEach(() => cleanup());

const mount = () => {
  setWidth(390);
  render(
    <PageChromeBar>
      <PageMenu authed />
      <PageControls label="Artifact controls" />
    </PageChromeBar>,
  );
  return screen.getByRole('toolbar', { name: 'Page actions' });
};

describe('framed scroll samples', () => {
  it('the FIRST sample seeds the baseline and never hides the bar by itself', () => {
    const bar = mount();
    // A reload lands the reader mid-document: the first sample is 500, not 0.
    act(() => notifyPageChromeScroll(500));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'false');
    act(() => notifyPageChromeScroll(520));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'true');
    act(() => notifyPageChromeScroll(500));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'false');
  });

  it('a sample that says the document is at its end keeps the bar up, and hides again once it leaves the end', () => {
    const bar = mount();
    act(() => notifyPageChromeScroll(100));
    act(() => notifyPageChromeScroll(140));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'true');
    act(() => notifyPageChromeScroll(900, true));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'false');
    act(() => notifyPageChromeScroll(880, false));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'false');
    act(() => notifyPageChromeScroll(896, false));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'true');
  });
});
