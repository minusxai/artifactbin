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
