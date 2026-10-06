/* @jsxImportSource solid-js */
import {render,screen,fireEvent,waitFor,cleanup} from '@solidjs/testing-library';
import {it,expect,vi,afterEach} from 'vitest';
import {LoginPage} from '../pages/Login';
vi.mock('@/solid/lib/session',()=>({useSession:()=>({session:()=>({user:null,kind:'none',onboarded:true}),sessionError:()=>null})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
it('uses the existing email login handlers and continues without navigating away from an in-memory offer',async()=>{
 window.history.replaceState(null,'','/connect?request=portable');const done=vi.fn();
 const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}',{status:200}));vi.stubGlobal('fetch',fetch);
 render(()=> <LoginPage onAuthenticated={done}/>);
 fireEvent.input(screen.getByRole('textbox',{name:'Email'}),{target:{value:'mxmx_test_connect@example.com'}});
 fireEvent.click(screen.getByRole('button',{name:'Log in with email'}));
 const code=await screen.findByRole('textbox',{name:'Login code'});fireEvent.input(code,{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Verify code'}));
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());
 expect(location.pathname+location.search).toBe('/connect?request=portable');
 expect(fetch.mock.calls.map(call=>call[0])).toEqual(['/api/auth/email-otp/send-verification-otp','/api/auth/sign-in/email-otp']);
});

for (const [name, failure] of [
 ['network interruption', () => Promise.reject(new TypeError('Failed to fetch'))],
 ['server temporarily unavailable', () => Promise.resolve(new Response('{}', {status:503}))],
] as const) {
 it(`preserves the login code and offers a truthful retry after ${name}`, async()=>{
  const done=vi.fn();
  const request=vi.fn<typeof globalThis.fetch>()
   .mockResolvedValueOnce(new Response('{}',{status:200}))
   .mockImplementationOnce(failure)
   .mockResolvedValueOnce(new Response('{}',{status:200}));
  vi.stubGlobal('fetch',request);render(()=> <LoginPage onAuthenticated={done}/>);
  fireEvent.input(screen.getByRole('textbox',{name:'Email'}),{target:{value:'mxmx_test_transport@example.com'}});
  fireEvent.click(screen.getByRole('button',{name:'Log in with email'}));
  const code=await screen.findByRole('textbox',{name:'Login code'});
  fireEvent.input(code,{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Verify code'}));
  await screen.findByText(/Couldn.t reach the server|temporarily unavailable/i);
  expect(screen.queryByText(/That code isn.t right/)).toBeNull();
  expect((code as HTMLInputElement).value).toBe('123456');
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Verify code'}));
  await waitFor(()=>expect(done).toHaveBeenCalledOnce());
  const attempts=request.mock.calls.filter(call=>call[0]==='/api/auth/sign-in/email-otp');
  expect(attempts).toHaveLength(2);
  expect(attempts.map(call=>JSON.parse(String(call[1]?.body)))).toEqual([
   {email:'mxmx_test_transport@example.com',otp:'123456'},
   {email:'mxmx_test_transport@example.com',otp:'123456'},
  ]);
 });
}
it('still explains an actually rejected login code',async()=>{
 const done=vi.fn();vi.stubGlobal('fetch',vi.fn<typeof globalThis.fetch>()
  .mockResolvedValueOnce(new Response('{}',{status:200}))
  .mockResolvedValueOnce(new Response('{}',{status:400})));
 render(()=> <LoginPage onAuthenticated={done}/>);
 fireEvent.input(screen.getByRole('textbox',{name:'Email'}),{target:{value:'mxmx_test_rejected@example.com'}});
 fireEvent.click(screen.getByRole('button',{name:'Log in with email'}));
 fireEvent.input(await screen.findByRole('textbox',{name:'Login code'}),{target:{value:'123456'}});
 fireEvent.click(screen.getByRole('button',{name:'Verify code'}));
 await screen.findByText(/That code isn.t right/);expect(done).not.toHaveBeenCalled();
});
