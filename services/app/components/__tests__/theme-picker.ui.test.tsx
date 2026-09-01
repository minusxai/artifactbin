/**
 * ThemePicker — the theme control for /a/<id> chrome, in both modes.
 *
 * Six flat buttons made the top bar a wall of words that said nothing about what
 * a theme LOOKS like. This is one trigger naming the current theme, opening a
 * grid of the real preview images (public/story-themes/<name>.png).
 *
 * Picking is not a preference toggle: the caller turns it into an edit (the
 * viewer enters edit mode, where it saves), so the picker only reports the pick.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ThemePicker, { ModeChip } from '../ThemePicker';
import { getStoryTheme } from '@/lib/data/story/story-themes';
import { STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';

const swatch = () => screen.getByLabelText('Theme').querySelector('[data-theme-swatch]') as HTMLElement;

describe('ThemePicker', () => {
  it('labels the trigger "Theme: <name>", and lists none of the others', () => {
    render(<ThemePicker value="terminal" onPick={() => {}} />);
    // The bar has several controls; "Nocturne" alone doesn't say what it changes.
    expect(screen.getByLabelText('Theme').textContent).toMatch(/Theme:\s*terminal/i);
    // Closed: the six options are not in the document at all, so the bar stays quiet.
    expect(screen.queryByLabelText('Theme manuscript')).toBeNull();
  });

  it('carries a swatch of the theme\'s OWN accent, not an invented colour', () => {
    render(<ThemePicker value="organic" onPick={() => {}} />);
    // Every theme declares --primary; reusing it means the dot can never drift
    // from the palette it stands for.
    const primary = getStoryTheme('organic')!.cssVars['--primary'];
    expect(swatch().style.backgroundColor || swatch().style.background).toContain(primary);
  });

  it('says so when the document has no theme yet, and shows no accent', () => {
    render(<ThemePicker value={null} onPick={() => {}} />);
    expect(screen.getByLabelText('Theme').textContent).toMatch(/theme/i);
    // Nothing to stand for: a filled dot would claim a palette the document lacks.
    expect(swatch().style.background).toBe('');
    expect(swatch().style.backgroundColor).toBe('');
  });

  it('opens a grid of all six themes, each showing its real preview image', async () => {
    render(<ThemePicker value="terminal" onPick={() => {}} />);
    fireEvent.click(screen.getByLabelText('Theme'));

    for (const name of STORY_THEME_NAMES) {
      const option = screen.getByLabelText(`Theme ${name}`);
      const img = option.querySelector('img')!;
      // The preview is the point — a picker of names is what we are replacing.
      // Each card shows its effective mode's own image (terminal defaults dark).
      const suffix = getStoryTheme(name)!.defaultMode === 'dark' ? '-dark' : '';
      expect(img.getAttribute('src')).toBe(`/story-themes/${name}${suffix}.png`);
    }
    // The current one is marked, so the grid says where you already are.
    expect(screen.getByLabelText('Theme terminal').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Theme organic').getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the pick and closes', async () => {
    const onPick = vi.fn();
    render(<ThemePicker value="terminal" onPick={onPick} />);
    fireEvent.click(screen.getByLabelText('Theme'));
    fireEvent.click(screen.getByLabelText('Theme pop'));

    expect(onPick).toHaveBeenCalledWith('pop');
    // Closed again: the pick is a one-shot, and the caller navigates from here.
    expect(screen.queryByLabelText('Theme pop')).toBeNull();
  });

  it('previews each card in its EFFECTIVE mode: the explicit colorMode, else that theme\'s default', () => {
    // No colorMode pinned: terminal (dark-default) shows its dark card, the rest light.
    render(<ThemePicker value={null} onPick={() => {}} />);
    fireEvent.click(screen.getByLabelText('Theme'));
    expect(screen.getByLabelText('Theme terminal').querySelector('img')!.getAttribute('src')).toBe('/story-themes/terminal-dark.png');
    expect(screen.getByLabelText('Theme modernist').querySelector('img')!.getAttribute('src')).toBe('/story-themes/modernist.png');
  });

  it('a pinned colorMode previews every theme in that mode', () => {
    render(<ThemePicker value={null} colorMode="dark" onPick={() => {}} />);
    fireEvent.click(screen.getByLabelText('Theme'));
    expect(screen.getByLabelText('Theme modernist').querySelector('img')!.getAttribute('src')).toBe('/story-themes/modernist-dark.png');
    render(<ThemePicker value={null} colorMode="light" onPick={() => {}} />);
    fireEvent.click(screen.getAllByLabelText('Theme')[1]);
    expect(screen.getAllByLabelText('Theme terminal')[1].querySelector('img')!.getAttribute('src')).toBe('/story-themes/terminal.png');
  });

  it("the swatch carries the effective mode's own --primary", () => {
    render(<ThemePicker value="terminal" onPick={() => {}} />);
    // terminal defaults dark, so the dot is the DARK palette's primary.
    const primary = getStoryTheme('terminal')!.darkCssVars['--primary'];
    expect(swatch().style.backgroundColor || swatch().style.background).toContain(primary);
  });

  it('closes on Escape without reporting a pick', async () => {
    const onPick = vi.fn();
    render(<ThemePicker value={null} onPick={onPick} />);
    fireEvent.click(screen.getByLabelText('Theme'));
    expect(screen.getByLabelText('Theme industry')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('Theme industry')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  /**
   * On a phone the trigger sits wherever the bar puts it — mid-row — so a panel
   * hung off it (`absolute left-0`) started 180px in and ran 200px past a 390px
   * screen: half the themes clipped, page scrolling sideways
   * (scripts/gate-mobile.mjs measured it). Below Tailwind's `sm` the panel is
   * pinned to the VIEWPORT instead, and drops to one column because two 13rem
   * cards cannot both fit.
   */
  describe('on a narrow screen', () => {
    const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
    afterEach(() => setWidth(1024));

    it('opens as a bottom sheet instead of hanging off the trigger', () => {
      setWidth(390);
      render(<ThemePicker value={null} onPick={vi.fn()} />);
      fireEvent.click(screen.getByLabelText('Theme'));

      // The MobileSheet dialog carries the panel's label; the cards inside
      // drop to one column because two 13rem cards cannot both fit.
      const panel = screen.getByLabelText('Themes');
      expect(panel.getAttribute('role')).toBe('dialog');
      expect(panel.className).toContain('bottom-0');
      expect(panel.querySelector('.grid')?.className).toContain('grid-cols-1');
      expect(panel.className).not.toContain('w-[26rem]');
    });

    /**
     * Still anchored to the trigger on a wide screen — but PORTALLED there
     * rather than `absolute` inside it. The old in-place panel was clipped out
     * of existence by the editor toolbar's `overflow-x-auto` scroller, which
     * has no visible symptom at all: right box, right columns, no page
     * overflow, and nothing painted (see AnchoredPanel, and the hit test in
     * scripts/gate-mobile.mjs). So the assertion moved off `absolute` — the
     * mechanism that caused it — and onto what makes the panel reachable: it
     * is not a sheet, it is not inside the box that rendered it, and it still
     * lays the cards out in two columns.
     */
    it('keeps hanging off the trigger on a wide one, portalled out of it', () => {
      setWidth(1280);
      const { container } = render(<ThemePicker value={null} onPick={vi.fn()} />);
      fireEvent.click(screen.getByLabelText('Theme'));

      const panel = screen.getByLabelText('Themes');
      expect(panel.getAttribute('role')).toBe('group');
      expect(container.contains(panel)).toBe(false);
      expect(document.body.contains(panel)).toBe(true);
      expect(panel.className).toContain('grid-cols-2');
    });
  });
});

describe('ModeChip', () => {

  it('shows the effective mode and opens the three options', () => {
    render(<ModeChip mode={null} themeDefault="dark" onPick={() => {}} />);
    expect(screen.getByLabelText('Color mode').textContent).toMatch(/Mode:\s*dark/);
    expect(screen.getByLabelText('Color mode')).toHaveAttribute('data-slot', 'tooltip-trigger');
    expect(screen.getByLabelText('Color mode')).not.toHaveAttribute('data-tip');
    fireEvent.click(screen.getByLabelText('Color mode'));
    expect(screen.getByLabelText('Color mode theme default').textContent).toContain('theme default (dark)');
    expect(screen.getByLabelText('Color mode theme default').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Color mode light')).toBeTruthy();
    expect(screen.getByLabelText('Color mode dark')).toBeTruthy();
  });

  it('reports an explicit pick, and theme default as an explicit null', () => {
    const onPick = vi.fn();
    render(<ModeChip mode="dark" themeDefault="light" onPick={onPick} />);
    fireEvent.click(screen.getByLabelText('Color mode'));
    fireEvent.click(screen.getByLabelText('Color mode light'));
    expect(onPick).toHaveBeenCalledWith('light');
    fireEvent.click(screen.getByLabelText('Color mode'));
    fireEvent.click(screen.getByLabelText('Color mode theme default'));
    expect(onPick).toHaveBeenLastCalledWith(null);
    // Picks close the menu.
    expect(screen.queryByLabelText('Color mode light')).toBeNull();
  });
});
