import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import ForkArtifact from '../ForkArtifact';
vi.unmock('@/lib/navigation');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('sends a cookie-less fork response to login through the client router', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({error:'unauthorized'}, {status:401})));
  const router=createMemoryRouter([{path:'/',element:<ForkArtifact id="abcdef"/>},{path:'/login',element:<p aria-label="Login page">Login</p>}]);
  render(<RouterProvider router={router}/>);
  fireEvent.click(screen.getByLabelText('Fork artifact'));
  fireEvent.click(screen.getByLabelText('Confirm fork'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(new URLSearchParams(router.state.location.search).get('callbackUrl')).toContain('intent=fork');
});

it.each([401, 409])('keeps query and hash in the login callback for %s', async status => {
  window.history.replaceState(null, '', '/a/abcdef?$region=west#selection');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({error:'sign_in_required'}, {status})));
  const router=createMemoryRouter([{path:'*',element:<ForkArtifact id="abcdef"/>}], {initialEntries:['/a/abcdef?$region=west#selection']});
  render(<StrictMode><RouterProvider router={router}/></StrictMode>);
  fireEvent.click(screen.getByLabelText('Fork artifact'));
  fireEvent.click(screen.getByLabelText('Confirm fork'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(new URLSearchParams(router.state.location.search).get('callbackUrl')).toBe('/a/abcdef?$region=west&intent=fork#selection');
});

it('commits a successful copy through the router', async () => {
  const fetchMock = vi.fn(async () => Response.json({url:`${window.location.origin}/@owner/copy01-document`}, {status:201}));
  vi.stubGlobal('fetch', fetchMock);
  const router=createMemoryRouter([{path:'*',element:<ForkArtifact id="abcdef"/>}]);
  render(<RouterProvider router={router}/>);
  fireEvent.click(screen.getByLabelText('Fork artifact'));
  fireEvent.click(screen.getByLabelText('Confirm fork'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/@owner/copy01-document'));
  // The door it POSTs to, from artifact-owner-chrome.ui.test.tsx, which drove the
  // same two navigations a second time through the whole shell.
  expect(fetchMock.mock.calls[0][0]).toBe('/api/my/artifacts/abcdef/fork');
});

it('keeps a forbidden response visible rather than sending the user to login', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({error:'forbidden'}, {status:403})));
  const router=createMemoryRouter([{path:'*',element:<ForkArtifact id="abcdef"/>}]);
  render(<StrictMode><RouterProvider router={router}/></StrictMode>);
  fireEvent.click(screen.getByLabelText('Fork artifact'));
  fireEvent.click(screen.getByLabelText('Confirm fork'));
  await waitFor(() => expect(screen.getByLabelText('Fork refused')).toHaveTextContent('forbidden'));
  expect(router.state.location.pathname).toBe('/');
});

it.each([201,401,409])('ignores a %s completion after the fork UI unmounts', async status => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => {finish=resolve;})));
  const router=createMemoryRouter([{path:'/',element:<ForkArtifact id="abcdef"/>},{path:'/account',element:<p>Account</p>}]);
  render(<RouterProvider router={router}/>);
  fireEvent.click(screen.getByLabelText('Fork artifact'));
  fireEvent.click(screen.getByLabelText('Confirm fork'));
  await act(async () => { await router.navigate('/account'); });
  const location = window.location;
  const hardNavigate = vi.fn();
  Object.defineProperty(window, 'location', {configurable:true, value:{...location, get href() {return location.href;}, set href(value: string) {hardNavigate(value);}}});
  try {
    await act(async () => { finish(Response.json({url:'/a/copy01',error:'sign_in_required'}, {status})); });
    expect(router.state.location.pathname).toBe('/account');
    expect(hardNavigate).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'location', {configurable:true, value:location});
  }
});
