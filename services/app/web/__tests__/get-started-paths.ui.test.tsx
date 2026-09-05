/** Getting Started keeps both installation paths available. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import GetStarted from '@/components/GetStarted';
import { TokensNewPage } from '@/web/pages/TokensNew';

afterEach(cleanup);
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const httpOption = () => screen.getByText(/no installation/i);
const installDoor = () => screen.getByRole('button', { name: /install for my agent/i });

describe('lead — which of the two paths comes first', () => {
  it('leads with the HTTP path by default, as the landing page has always shown it', () => {
    render(<MemoryRouter><GetStarted /></MemoryRouter>);
    expect(precedes(httpOption(), installDoor())).toBe(true);
  });

  it('leads with install when asked, without restyling either path', () => {
    render(<MemoryRouter><GetStarted lead="install" /></MemoryRouter>);
    expect(precedes(installDoor(), httpOption())).toBe(true);
    // Both paths are still on offer, and still exactly two.
    expect(screen.getByText(/no installation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^option [12]$/)).toHaveLength(2);
  });

  it('numbers the options by where they actually sit', () => {
    const { unmount } = render(<MemoryRouter><GetStarted lead="install" /></MemoryRouter>);
    expect(installDoor().textContent).toContain('option 1');
    expect(httpOption().closest('div')?.textContent).toContain('option 2');
    unmount();
    render(<MemoryRouter><GetStarted /></MemoryRouter>);
    expect(httpOption().closest('div')?.textContent).toContain('option 1');
    expect(installDoor().textContent).toContain('option 2');
  });
});


it.each(['', '?source=claude-code'])('the token page omits onboarding (%s)', (search) => {
  render(<MemoryRouter initialEntries={[`/tokens/new${search}`]}><TokensNewPage /></MemoryRouter>);
  expect(screen.queryByLabelText('Get started')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate a token' })).toBeInTheDocument();
});
