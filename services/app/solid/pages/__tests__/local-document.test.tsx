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
function ready(nonce='reader-nonce',role='viewer'){
 const options=captured.options!;
 options.onState('connected');
 options.onConnected?.({identity:{platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)},role,readOnly:true});
 options.onMessage?.({kind:'frame',payload:{kind:'ready',nonce}});
}
const command=(mode:'light'|'dark')=>({kind:'frame',payload:{kind:'send',command:{type:STORY_READER_MODE_MESSAGE,mode}}});

it('keeps platform comment reading but sends every account action to the original',async()=>{
 const open=vi.spyOn(window,'open').mockReturnValue(null);mount();ready();expect(await screen.findByRole('button',{name:'Open original'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Open original'}));expect(open).toHaveBeenCalledWith('https://platform.example/a/p','_blank','noopener');expect(screen.queryByRole('button',{name:'Sign in'})).toBeNull();expect(screen.queryByRole('button',{name:'Open menu'})).toBeNull();expect(screen.queryByRole('button',{name:'Connect this file'})).toBeNull();expect(await screen.findByRole('button',{name:'Save linked HTML'})).toBeTruthy();await waitFor(()=>expect(annotation.canCreate).toBe(false));
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

it('never offers account upgrade or comment creation even with an ambient owner session',async()=>{
 account.signedIn=true;mount();ready();await waitFor(()=>expect(annotation.canCreate).toBe(false));expect(annotation.onSignIn).toBeUndefined();expect(screen.queryByRole('button',{name:'Use my account'})).toBeNull();expect(screen.queryByRole('button',{name:'Sign in'})).toBeNull();expect(broker.authorize).not.toHaveBeenCalled();
});
it('opens trusted recovery after idle blocking without implicitly approving an account',async()=>{
 account.signedIn=true;mount();ready();fireEvent.click(await screen.findByRole('button',{name:'Close artifact controls'}));expect(screen.queryByRole('button',{name:'Retry'})).toBeNull();captured.options!.onState('blocked');fireEvent.click(await screen.findByRole('button',{name:'Retry'}));expect(broker.retry).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'Open original'})).toBeTruthy();expect(broker.authorize).not.toHaveBeenCalled();expect(broker.signIn).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Use my account'})).toBeNull();
});
