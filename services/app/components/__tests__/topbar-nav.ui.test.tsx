/** The page-level hamburger keeps the old navigation without reserving a bar. */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageMenu } from '@/components/PageChrome';
import { router, resetRouter } from '@/test/setup/router';

beforeEach(resetRouter);

describe('page menu', () => {
  it('is one floating control, not a header', () => {
    const { container } = render(<PageMenu authed />);
    const burger = screen.getByLabelText('Open menu');
    expect(burger).toHaveClass('absolute', 'rounded-full');
    expect(container.querySelector('header')).toBeNull();
  });

  it('becomes a flat, full-height toolbar action when editor chrome is present', () => {
    render(<PageMenu authed toolbar />);
    const burger = screen.getByLabelText('Open menu');
    expect(burger).toHaveAttribute('data-chrome-placement', 'toolbar');
    expect(burger).toHaveClass('fixed', 'left-0', 'top-0', 'h-12', 'w-12', 'border-0', 'bg-transparent');
    expect(burger).not.toHaveClass('rounded-full', 'shadow-sm');
  });

  it('offers the complete navigation and account action when opened', () => {
    render(<PageMenu authed />);
    expect(screen.queryByLabelText('Menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('Open menu'));
    for (const label of ['Artifacts', 'Account', 'Human Docs', 'Agent docs', 'Sign out']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Tokens')).toBeNull();
  });

  it('puts page context inside the menu instead of across the viewport', () => {
    router.path = '/@vivek/notes/ab12cd-my-doc';
    render(<PageMenu authed title="My doc" />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    const context = screen.getByLabelText('Current page');
    expect(context).toHaveTextContent('@vivek');
    expect(context).toHaveTextContent('My doc');
    expect(context.querySelector('a')).toHaveAttribute('href', '/@vivek');
  });

  it('highlights the current destination', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Artifacts')).toHaveClass('text-accent');
    expect(screen.getByLabelText('Account')).not.toHaveClass('text-accent');
  });

  it('closes by click-away and keeps the catcher above the page', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    const overlay = screen.getByLabelText('Close the menu');
    expect(overlay).toHaveClass('fixed', 'z-40');
    fireEvent.click(overlay);
    expect(screen.queryByLabelText('Menu')).toBeNull();
  });

  it('is a full-width sheet on phones and a narrow drawer from sm up', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Menu')).toHaveClass('w-full', 'sm:w-72');
  });

  it('offers log in when there is no session', () => {
    render(<PageMenu authed={false} />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Login')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });
});

describe('the old /tokens address', () => {
  it('still forwards to /account', async () => {
    const { App } = await import('@/web/App');
    const src = String((await import('node:fs')).readFileSync('web/App.tsx', 'utf8'));
    expect(src.replace(/\s+/g, ' ')).toContain('path="/tokens" element={<Navigate to="/account" replace />}');
    expect(App).toBeTruthy();
  });
});
