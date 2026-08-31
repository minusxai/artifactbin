/** The right-hand page control is the single responsive home for page actions. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyPageChromeScroll, PageChromeBar, PageControls, PageMenu } from '@/components/PageChrome';

const setWidth = (width: number) => Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
const setScrollY = (scrollY: number) => Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });

afterEach(() => {
  cleanup();
  setWidth(1024);
  setScrollY(0);
  vi.unstubAllGlobals();
});

describe('PageControls', () => {
  it('sits on the page and keeps appearance behind one sliders control', () => {
    const { container } = render(<PageControls />);
    expect(container.querySelector('header')).toBeNull();
    fireEvent.click(screen.getByLabelText('Open page controls'));
    expect(screen.getByLabelText('Page controls')).toBeInTheDocument();
    expect(screen.getByLabelText('Light mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Dark mode')).toBeInTheDocument();
  });

  it('changes and persists the app appearance', () => {
    render(<PageControls />);
    fireEvent.click(screen.getByLabelText('Open page controls'));
    fireEvent.click(screen.getByLabelText('Light mode'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('mx_theme')).toBe('light');
    fireEvent.click(screen.getByLabelText('Dark mode'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('uses a controlled appearance for a document', () => {
    const pick = vi.fn();
    render(<PageControls label="Artifact controls" mode="light" onModeChange={pick} />);
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    expect(screen.getByLabelText('Light mode')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByLabelText('Dark mode'));
    expect(pick).toHaveBeenCalledWith('dark');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('mx_theme')).toBe('dark');
    fireEvent.click(screen.getByLabelText('Light mode'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(pick).toHaveBeenLastCalledWith('light');
  });

  it('moves to a document edge that has a desktop side rail', () => {
    render(<PageControls label="Artifact controls" rightOffset={332} />);
    const trigger = screen.getByLabelText('Open artifact controls');
    expect(trigger).toHaveStyle({ right: '332px' });
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Artifact controls')).toHaveStyle({ right: '332px' });
  });

  it('renders capability actions supplied by the page', () => {
    render(
      <PageControls label="Artifact controls">
        {(close) => <button aria-label="Edit artifact" onClick={close}>edit</button>}
      </PageControls>,
    );
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    fireEvent.click(screen.getByLabelText('Edit artifact'));
    expect(screen.queryByLabelText('Artifact controls')).toBeNull();
  });

  it('becomes a bottom sheet on a phone', () => {
    setWidth(390);
    render(<PageControls />);
    fireEvent.click(screen.getByLabelText('Open page controls'));
    const dialog = screen.getByLabelText('Page controls');
    expect(dialog).toHaveClass('bottom-0', 'rounded-t-[10px]');
  });

  it('uses a full-width phone bar with menu, home, and controls', () => {
    setWidth(390);
    render(
      <PageChromeBar>
        <PageMenu authed />
        <PageControls label="Artifact controls" />
      </PageChromeBar>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Page actions' });
    expect(bar).toHaveClass('fixed', 'inset-x-0', 'w-full', 'border-t');
    expect(screen.getByLabelText('Open menu')).toHaveAttribute('data-chrome-placement', 'mobile-bar');
    expect(screen.getByLabelText('Open menu')).toHaveTextContent('menu');
    expect(screen.getByLabelText('Open menu').parentElement).toHaveAttribute('data-mobile-bar-slot', 'menu');
    expect(screen.getByLabelText('Open menu').parentElement).toHaveClass('w-full', 'justify-center');
    expect(screen.getByLabelText('Home')).toHaveAttribute('href', '/');
    expect(screen.getByLabelText('Home')).toHaveTextContent('home');
    expect(screen.getByLabelText('Open artifact controls')).toHaveAttribute('data-chrome-placement', 'mobile-bar');
    expect(screen.getByLabelText('Open artifact controls')).toHaveTextContent('controls');
    expect(screen.getByLabelText('Open artifact controls').parentElement).toHaveAttribute('data-mobile-bar-slot', 'controls');
    expect(screen.getByLabelText('Open artifact controls').parentElement).toHaveClass('w-full', 'justify-center');
  });

  it('hides with downward page scroll and returns on reverse scroll', () => {
    setWidth(390);
    render(
      <PageChromeBar>
        <PageMenu authed />
        <PageControls />
      </PageChromeBar>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Page actions' });
    setScrollY(120);
    fireEvent.scroll(window);
    expect(bar).toHaveAttribute('data-scroll-hidden', 'true');
    setScrollY(90);
    fireEvent.scroll(window);
    expect(bar).toHaveAttribute('data-scroll-hidden', 'false');
  });

  it('uses framed artifact scroll samples and stays out of an open sheet', () => {
    setWidth(390);
    render(
      <PageChromeBar>
        <PageMenu authed />
        <PageControls label="Artifact controls" />
      </PageChromeBar>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Page actions' });
    act(() => notifyPageChromeScroll(140));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'true');
    act(() => notifyPageChromeScroll(80));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'false');
    fireEvent.click(screen.getByLabelText('Open artifact controls'));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'true');
    fireEvent.click(screen.getByLabelText('Dismiss artifact controls'));
    expect(bar).toHaveAttribute('data-scroll-hidden', 'false');
  });
});
