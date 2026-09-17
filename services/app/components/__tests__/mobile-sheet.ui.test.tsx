/**
 * MobileSheet — the app-like bottom sheet a PHONE gets where desktop gets an
 * anchored popover. ONE primitive used by ThemePicker, version history,
 * because a second hand-rolled panel is how two surfaces start disagreeing
 * about dismissal (the RowMenu lesson). The caller decides WHEN it is used —
 * it owns the desktop alternative — the sheet owns everything else: backdrop,
 * Escape, the slide-up, the scroll cap.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileSheet, { isPhoneViewport } from '@/components/MobileSheet';
import ShareLink from '@/components/ShareLink';
import ThemePicker, { ModeChip } from '@/components/ThemePicker';
import VersionHistory from '@/components/VersionHistory';

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });

afterEach(() => {
  cleanup();
  setWidth(1024);
  vi.unstubAllGlobals();
});

describe('MobileSheet', () => {
  it('renders a labelled dialog whose backdrop closes it', () => {
    const onClose = vi.fn();
    render(<MobileSheet label="Sharing" onClose={onClose}>hello</MobileSheet>);
    const panel = screen.getByLabelText('Sharing');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.textContent).toContain('hello');
    fireEvent.click(screen.getByLabelText('Close sheet'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('size="half" caps the sheet at half the screen and puts NO scrim over the subject — it stays readable and scrollable', () => {
    render(<MobileSheet label="Comments" onClose={() => {}} size="half">hi</MobileSheet>);
    expect(screen.getByLabelText('Comments').className).toContain('max-h-[50vh]');
    expect(screen.queryByLabelText('Close sheet')).toBeNull();
    cleanup();
    render(<MobileSheet label="Sharing" onClose={() => {}}>hi</MobileSheet>);
    expect(screen.getByLabelText('Sharing').className).toContain('max-h-[80vh]');
    expect(screen.getByLabelText('Close sheet')).toBeTruthy();
  });

  it('a header rides ABOVE the scrolling body, so it never scrolls away', () => {
    render(
      <MobileSheet label="Comments" onClose={() => {}} header={<span>comments-head</span>}>
        body
      </MobileSheet>,
    );
    const panel = screen.getByLabelText('Comments');
    const scroller = panel.querySelector('.overflow-y-auto');
    expect(scroller?.textContent).toContain('body');
    expect(scroller?.textContent).not.toContain('comments-head');
    expect(panel.textContent).toContain('comments-head');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<MobileSheet label="Sharing" onClose={onClose}>hi</MobileSheet>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('isPhoneViewport is exactly Tailwind\'s sm threshold', () => {
    setWidth(639);
    expect(isPhoneViewport()).toBe(true);
    setWidth(640);
    expect(isPhoneViewport()).toBe(false);
  });
});

describe('ShareLink dialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/sharing')) {
        return new Response(JSON.stringify({ visibility: 'private', shares: [] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  });

  it('opens the same centered sharing modal on a phone', async () => {
    setWidth(390);
    render(<ShareLink className="x" artifactId="Ab3xK9" owner />);
    fireEvent.click(screen.getByLabelText('Share'));

    const dialog = screen.getByLabelText('Sharing');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.className).toContain('max-w-2xl');
    expect(dialog.className).not.toContain('bottom-0');
    await waitFor(() => expect(screen.getByLabelText('Copy link')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Close sharing'));
    expect(screen.queryByLabelText('Copy link')).toBeNull();
  });

  it('uses the centered modal on desktop too', () => {
    setWidth(1280);
    render(<ShareLink className="x" artifactId="Ab3xK9" owner />);
    fireEvent.click(screen.getByLabelText('Share'));
    expect(screen.getByLabelText('Sharing')).toBeTruthy();
    expect(screen.getByLabelText('Copy link')).toBeTruthy();
  });
});

describe('ModeChip on a phone', () => {
  it('opens the three modes inside a bottom sheet', () => {
    setWidth(390);
    render(<ModeChip mode={null} themeDefault="dark" onPick={() => {}} />);
    fireEvent.click(screen.getByLabelText('Color mode'));

    const sheet = screen.getByLabelText('Color modes');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(screen.getByLabelText('Color mode dark')).toBeTruthy();
  });
});

describe('VersionHistory on a phone', () => {
  it('is a half bottom sheet, so a previewed version stays visible', () => {
    setWidth(390);
    render(
      <VersionHistory
        versions={[]} currentVersion={3} previewing={null} busy={false}
        onPreview={() => {}} onRestore={() => {}} onBackToCurrent={() => {}} onClose={() => {}}
      />,
    );
    const sheet = screen.getByLabelText('Version history');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.className).toContain('max-h-[50vh]');
    // The title row + close stay pinned above the scrolling list.
    const scroller = sheet.querySelector('.overflow-y-auto');
    expect(scroller?.contains(screen.getByLabelText('Close version history'))).toBe(false);
  });
});

describe('ThemePicker on a phone', () => {
  it('opens the theme cards inside a bottom sheet', () => {
    setWidth(390);
    render(<ThemePicker value={null} onPick={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Theme'));

    // The sheet carries the label the anchored panel used to, so the mobile
    // gate's geometry check needs no new vocabulary.
    const sheet = screen.getByLabelText('Themes');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(screen.getByLabelText('Theme terminal')).toBeTruthy();
    // Pinned header: the close control must not scroll away with the cards.
    const scroller = sheet.querySelector('.overflow-y-auto');
    expect(scroller?.contains(screen.getByLabelText('Close themes'))).toBe(false);

    fireEvent.click(screen.getByLabelText('Close sheet'));
    expect(screen.queryByLabelText('Theme terminal')).toBeNull();
  });
});
