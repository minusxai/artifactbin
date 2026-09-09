import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { HomePage } from '../pages/Home';
import { SessionProvider, useSession } from '../session';
import { captureInitialStory, clearInitialStory, clearInitialStoryOnRoute } from '../initial-story';

vi.mock('@/components/viz/VegaChart', () => ({ VegaChart: () => <div /> }));
afterEach(() => { cleanup(); clearInitialStory(); clearInitialStoryOnRoute('/away'); vi.unstubAllGlobals(); });
const markInitial = () => {
  const element = document.createElement('div');
  element.setAttribute('data-mx-initial-home', '');
  element.textContent = 'server landing';
  document.body.append(element);
  captureInitialStory();
  return element;
};
it('removes server sibling only when real Home commits, keeping Landing through slow session and home', async () => {
  const initial = markInitial();
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/session') ? new Promise<Response>(r => { resolve = r; }) : new Promise<Response>(() => {})));
  expect(initial.isConnected).toBe(true);
  render(<MemoryRouter><SessionProvider><HomePage /></SessionProvider></MemoryRouter>);
  expect(initial.isConnected).toBe(false);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Your agents');
  expect(screen.queryByLabelText('Loading workspace')).toBeNull();
  await act(async () => resolve(new Response(JSON.stringify({ kind: 'none', user: null }))));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Your agents');
  expect(screen.queryByLabelText('Loading workspace')).toBeNull();
});
it('clears the server sibling on navigation before Home ever loads', () => {
  const initial = markInitial();
  clearInitialStoryOnRoute('/login');
  expect(initial.isConnected).toBe(false);
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  render(<MemoryRouter><SessionProvider><HomePage /></SessionProvider></MemoryRouter>);
  expect(screen.getByLabelText('Loading workspace')).toBeInTheDocument();
});
it('never reuses initial public eligibility after an account has replaced it', async () => {
  markInitial();
  let answer = true;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/session') && answer
    ? Promise.resolve(new Response(JSON.stringify({ kind: 'account', user: { id: 'one', email: null } })))
    : new Promise<Response>(() => {})));
  function Reload() { const { reload } = useSession(); return <button onClick={reload}>Reload identity</button>; }
  render(<MemoryRouter><SessionProvider><Reload /><HomePage /></SessionProvider></MemoryRouter>);
  await screen.findByLabelText('Loading workspace');
  answer = false;
  fireEvent.click(screen.getByText('Reload identity'));
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  expect(screen.getByLabelText('Loading workspace')).toBeInTheDocument();
});
