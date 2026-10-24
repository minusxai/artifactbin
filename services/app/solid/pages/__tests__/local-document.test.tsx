/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@solidjs/testing-library';
import {MemoryRouter,Route} from '@solidjs/router';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {LocalBrokerOptions} from '@/lib/local-connection/broker';
import {STORY_READER_MODE_MESSAGE} from '@/lib/story-runtime/contract';
import {LocalDocumentPage} from '../LocalDocument';
const broker=vi.hoisted(()=>({authorize:vi.fn(),signIn:vi.fn(),resize:vi.fn(),post:vi.fn(),disconnect:vi.fn(),retry:vi.fn(),dispose:vi.fn()}));
const account=vi.hoisted(()=>({signedIn:false}));
vi.mock('../../lib/session',()=>({useSession:()=>({session:()=>({kind:account.signedIn?'account':'none'})})}));
const annotation=vi.hoisted(()=>({canCreate:false,onSignIn:undefined as (()=>void)|undefined}));
const captured=vi.hoisted(()=>({options:null as LocalBrokerOptions|null}));
vi.mock('@/lib/local-connection/broker',()=>({installLocalConnectionBroker(options:LocalBrokerOptions){captured.options=options;options.onIdentity?.({platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)});options.onState('permission-required');return broker;}}));
vi.mock('../../document/AnnotationLayer',()=>({AnnotationLayer:(props:{canCreateComment:boolean;onSignIn?:()=>void})=>{Object.defineProperty(annotation,'onSignIn',{get:()=>props.onSignIn,configurable:true});Object.defineProperty(annotation,'canCreate',{get:()=>props.canCreateComment,configurable:true});return null;}}));
beforeEach(()=>{vi.clearAllMocks();account.signedIn=false;localStorage.clear();document.documentElement.removeAttribute('data-theme');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));});
afterEach(async()=>{cleanup();await vi.dynamicImportSettled();localStorage.clear();document.documentElement.removeAttribute('data-theme');vi.unstubAllGlobals();});
const mount=()=>render(()=><MemoryRouter><Route path="/" component={LocalDocumentPage}/></MemoryRouter>);
function ready(nonce='reader-nonce',authenticated=false,role='viewer'){
 const options=captured.options!;
 options.onState('connected');
 options.onConnected?.({identity:{platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)},role,authenticated});
 options.onMessage?.({kind:'frame',payload:{kind:'ready',nonce}});
}
const command=(mode:'light'|'dark')=>({kind:'frame',payload:{kind:'send',command:{type:STORY_READER_MODE_MESSAGE,mode}}});

it('uses platform chrome and asks explicit permission without a destination editor',async()=>{
 mount();
 fireEvent.click(await screen.findByRole('button',{name:'Connect this file'}));
 expect(broker.authorize).toHaveBeenCalledOnce();
 expect(screen.queryByRole('textbox')).toBeNull();
 expect(screen.getByRole('button',{name:'Save linked HTML'})).toBeTruthy();
 await waitFor(()=>expect(broker.resize).toHaveBeenCalled());
});

it('shows the app appearance while preserving the author mode until the reader chooses',async()=>{
 document.documentElement.dataset.theme='dark';
 mount();
 ready();
 const dark=await screen.findByRole('button',{name:'Dark mode'});
 expect(dark).toHaveAttribute('aria-pressed','true');
 expect(broker.post).not.toHaveBeenCalled();
 expect(localStorage.getItem('mx_theme')).toBeNull();
});

it('sends standard Light and Dark commands and updates the already-open controls surface',async()=>{
 document.documentElement.dataset.theme='dark';
 mount();ready();
 const light=await screen.findByRole('button',{name:'Light mode'});
 const surface=screen.getByRole('region',{name:'Artifact controls'});
 fireEvent.click(light);
 await waitFor(()=>expect(broker.post).toHaveBeenLastCalledWith(command('light')));
 expect(localStorage.getItem('mx_theme')).toBe('light');
 expect(document.documentElement).not.toHaveAttribute('data-theme');
 await waitFor(()=>expect(surface.parentElement).not.toHaveAttribute('data-app-appearance','dark'));
 expect(light).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Dark mode'}));
 await waitFor(()=>expect(broker.post).toHaveBeenLastCalledWith(command('dark')));
 expect(localStorage.getItem('mx_theme')).toBe('dark');
 expect(document.documentElement).toHaveAttribute('data-theme','dark');
 await waitFor(()=>expect(surface.parentElement).toHaveAttribute('data-app-appearance','dark'));
 expect(surface).toBeInTheDocument();
});

it('sends an existing reader choice when the reader becomes ready and again for a new nonce',async()=>{
 localStorage.setItem('mx_theme','dark');document.documentElement.dataset.theme='dark';
 mount();
 expect(broker.post).not.toHaveBeenCalled();
 ready('first-nonce');
 await waitFor(()=>expect(broker.post).toHaveBeenLastCalledWith(command('dark')));
 broker.post.mockClear();
 captured.options!.onMessage?.({kind:'frame',payload:{kind:'ready',nonce:'second-nonce'}});
 await waitFor(()=>expect(broker.post).toHaveBeenCalledOnce());
 expect(broker.post).toHaveBeenLastCalledWith(command('dark'));
});

it('keeps a signed-in public guest read-only until explicit account approval',async()=>{
 account.signedIn=true;mount();ready();
 const action=await screen.findByRole('button',{name:'Use my account'});
 expect(broker.authorize).not.toHaveBeenCalled();expect(annotation.canCreate).toBe(false);
 fireEvent.click(action);expect(broker.authorize).toHaveBeenCalledOnce();
 await waitFor(()=>expect(annotation.onSignIn).toBeTypeOf('function'));broker.authorize.mockClear();annotation.onSignIn?.();expect(broker.authorize).toHaveBeenCalledOnce();
 ready('account-reader',true,'commenter');await waitFor(()=>expect(annotation.canCreate).toBe(true));
 expect(screen.queryByRole('button',{name:'Use my account'})).toBeNull();
});
it('offers sign-in to a connected signed-out public guest',async()=>{
 mount();ready();fireEvent.click(await screen.findByRole('button',{name:'Sign in'}));
 expect(broker.signIn).toHaveBeenCalledOnce();expect(broker.authorize).not.toHaveBeenCalled();
});
