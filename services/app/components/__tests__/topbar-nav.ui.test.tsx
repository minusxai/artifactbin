/** The page-level hamburger keeps the old navigation without reserving a bar. */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppBar, PageMenu } from '@/components/PageChrome';
import { router, resetRouter } from '@/test/setup/router';

beforeEach(resetRouter);

describe('page menu', () => {
  it('is one floating control, not a header', () => {
    const { container } = render(<PageMenu authed />);
    const burger = screen.getByLabelText('Open menu');
    expect(burger).toHaveClass('absolute', 'rounded-full');
    expect(container.querySelector('header')).toBeNull();
  });

  it('in edit mode the page bar carries the account button, fixed over the editor, with the mode named in the middle', () => {
    render(<AppBar fixed center={<span aria-label="Edit mode">edit mode</span>} />);
    const bar = screen.getByLabelText('Page bar');
    expect(bar).toHaveClass('fixed', 'top-0');
    expect(bar).toContainElement(screen.getByLabelText('Open menu'));
    expect(bar).toContainElement(screen.getByLabelText('Open page controls'));
    expect(screen.getByLabelText('Edit mode')).toHaveTextContent('edit mode');
    expect(screen.queryByLabelText('Current page')).toHaveTextContent('artifactbin');
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

  it('puts page context in the page bar and keeps it out of the account menu', () => {
    router.path = '/@vivek/notes/ab12cd-my-doc';
    render(<><AppBar title="My doc" /><PageMenu authed title="My doc" triggerless /></>);
    fireEvent.click(screen.getByLabelText('Open menu'));
    const context = screen.getByLabelText('Current page');
    expect(context).toHaveTextContent('@vivek');
    expect(context).toHaveTextContent('My doc');
    expect(within(context).getByRole('link', { name: '@vivek' })).toHaveAttribute('href', '/@vivek');
    expect(screen.getByLabelText('Page bar')).toContainElement(context);
    expect(screen.getByLabelText('Menu')).not.toContainElement(context);
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
