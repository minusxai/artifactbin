/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen,fireEvent,waitFor,within} from '@solidjs/testing-library';
import {MemoryRouter,Route} from '@solidjs/router';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {LocalBrokerOptions} from '@/lib/local-connection/broker';
import {STORY_READER_MODE_MESSAGE} from '@/lib/story-runtime/contract';
import {LocalDocumentPage} from '../LocalDocument';
const broker=vi.hoisted(()=>({sourceChanged:vi.fn(),authorize:vi.fn(),signIn:vi.fn(),resize:vi.fn(),post:vi.fn(),disconnect:vi.fn(),retry:vi.fn(),dispose:vi.fn()}));
const account=vi.hoisted(()=>({signedIn:false}));
vi.mock('../../lib/session',()=>({useSession:()=>({session:()=>({kind:account.signedIn?'account':'none'})})}));
const annotation=vi.hoisted(()=>({topOffset:undefined as number|undefined,canCreate:false,live:null as unknown,onSignIn:undefined as (()=>void)|undefined}));
const live=vi.hoisted(()=>({options:null as Parameters<typeof import('../../editor/create-live-artifact').createLiveArtifact>[0]|null}));
vi.mock('../../editor/create-live-artifact',()=>({createLiveArtifact(options:Parameters<typeof import('../../editor/create-live-artifact').createLiveArtifact>[0]){live.options=options;return ()=>null;}}));
const captured=vi.hoisted(()=>({options:null as LocalBrokerOptions|null}));
vi.mock('@/lib/local-connection/broker',()=>({installLocalConnectionBroker(options:LocalBrokerOptions){captured.options=options;options.onIdentity?.({platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)});options.onState('permission-required');return broker;}}));
vi.mock('../../document/AnnotationLayer',()=>({AnnotationLayer:(props:{topOffset?:number;canCreateComment:boolean;onSignIn?:()=>void;liveAnnotations?:unknown})=>{Object.defineProperty(annotation,'topOffset',{get:()=>props.topOffset,configurable:true});Object.defineProperty(annotation,'live',{get:()=>props.liveAnnotations,configurable:true});Object.defineProperty(annotation,'onSignIn',{get:()=>props.onSignIn,configurable:true});Object.defineProperty(annotation,'canCreate',{get:()=>props.canCreateComment,configurable:true});return null;}}));
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
 expect(broker.post.mock.calls.filter(call=>call[0]?.payload?.command?.type===STORY_READER_MODE_MESSAGE)).toHaveLength(0);
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
 expect(broker.post.mock.calls.filter(call=>call[0]?.payload?.command?.type===STORY_READER_MODE_MESSAGE)).toHaveLength(0);
 ready('first-nonce');
 await waitFor(()=>expect(broker.post).toHaveBeenLastCalledWith(command('dark')));
 broker.post.mockClear();
 captured.options!.onMessage?.({kind:'frame',payload:{kind:'ready',nonce:'second-nonce'}});
 await waitFor(()=>expect(broker.post.mock.calls.filter(call=>call[0]?.payload?.command?.type===STORY_READER_MODE_MESSAGE)).toHaveLength(1));
 expect(broker.post.mock.calls.filter(call=>call[0]?.payload?.command?.type===STORY_READER_MODE_MESSAGE).at(-1)).toEqual([command('dark')]);
});

it('never offers account upgrade or comment creation even with an ambient owner session',async()=>{
 account.signedIn=true;mount();ready();await waitFor(()=>expect(annotation.canCreate).toBe(false));expect(annotation.onSignIn).toBeUndefined();expect(screen.queryByRole('button',{name:'Use my account'})).toBeNull();expect(screen.queryByRole('button',{name:'Sign in'})).toBeNull();expect(broker.authorize).not.toHaveBeenCalled();
});
it('opens trusted recovery after idle blocking without implicitly approving an account',async()=>{
 account.signedIn=true;mount();ready();fireEvent.click(await screen.findByRole('button',{name:'Close artifact controls'}));expect(screen.queryByRole('button',{name:'Retry'})).toBeNull();captured.options!.onState('blocked');fireEvent.click(await screen.findByRole('button',{name:'Retry'}));expect(broker.retry).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'Open original'})).toBeTruthy();expect(broker.authorize).not.toHaveBeenCalled();expect(broker.signIn).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Use my account'})).toBeNull();ready('reconnected-nonce');await screen.findByRole('button',{name:'Readers · 0'});expect(annotation.canCreate).toBe(false);
});

it('connects anonymous live comments and presence only while the local transport is ready',async()=>{
 vi.stubGlobal('EventSource',class{});mount();ready();await waitFor(()=>expect(live.options?.enabled).toBe(true));expect(live.options?.backend.unavailable('live')).toBeNull();const comments:never[]=[];live.options?.onAnnotations?.(comments);await waitFor(()=>expect(annotation.live).toBe(comments));expect(await screen.findByRole('button',{name:'Readers · 0'})).toBeTruthy();live.options?.onPresence?.([{id:'peer',label:'Guest',revision:'1',seen:Date.now(),cursor:null,selection:null}]);await screen.findByRole('button',{name:'Readers · 1'});live.options?.onData?.({datasets:['counter'],version:1});expect(broker.post).toHaveBeenCalledWith({kind:'frame',payload:{kind:'send',command:{type:'mx:data',datasets:['counter']}}});live.options?.onPublication?.(2);expect(broker.sourceChanged).toHaveBeenCalledOnce();captured.options!.onState('unavailable');await waitFor(()=>expect(live.options?.enabled).toBe(false));expect(captured.options).toBeTruthy();
});

it('requests the parent viewport for controls and comments, then restores bar plus status height',async()=>{
 mount();ready();fireEvent.click(await screen.findByRole('button',{name:'Close artifact controls'}));await waitFor(()=>expect(broker.resize).toHaveBeenLastCalledWith(76));
 fireEvent.click(screen.getByRole('button',{name:'Open artifact controls'}));
 await waitFor(()=>expect(broker.resize).toHaveBeenLastCalledWith({mode:'viewport'}));
 fireEvent.click(await screen.findByRole('button',{name:'Close artifact controls'}));
 await waitFor(()=>expect(broker.resize).toHaveBeenLastCalledWith(76));
 fireEvent.click(screen.getByRole('button',{name:'Comment'}));
 await waitFor(()=>expect(broker.resize).toHaveBeenLastCalledWith({mode:'viewport'}));
 fireEvent.click(screen.getByRole('button',{name:'Comment'}));await waitFor(()=>expect(broker.resize).toHaveBeenLastCalledWith(76));
});
it('makes only the mounted local broker backdrop transparent and restores prior page backgrounds',()=>{
 document.documentElement.style.setProperty('background','rgb(1, 2, 3)','important');document.body.style.setProperty('background','linear-gradient(red, blue)');
 const html=document.documentElement.style.getPropertyValue('background'),body=document.body.style.getPropertyValue('background');
 const view=mount();expect(document.documentElement.style.getPropertyValue('background')).toBe('transparent');expect(document.body.style.getPropertyValue('background')).toBe('transparent');expect(document.body.style.getPropertyPriority('background')).toBe('important');
 view.unmount();expect(document.documentElement.style.getPropertyValue('background')).toBe(html);expect(document.documentElement.style.getPropertyPriority('background')).toBe('important');expect(document.body.style.getPropertyValue('background')).toBe(body);expect(document.body.style.getPropertyPriority('background')).toBe('');document.documentElement.style.removeProperty('background');document.body.style.removeProperty('background');
});

it('places the comment rail below both local chrome rows',async()=>{mount();ready();await waitFor(()=>expect(annotation.topOffset).toBe(76));});

it('keeps a matching transparent canvas scheme while dark platform controls retain their appearance',async()=>{
 document.documentElement.dataset.theme='dark';document.documentElement.style.setProperty('color-scheme','dark','important');
 const view=mount();ready();expect(document.documentElement.style.colorScheme).toBe('light');expect(document.documentElement.dataset.theme).toBe('dark');
 expect(await screen.findByRole('button',{name:'Dark mode'})).toHaveAttribute('aria-pressed','true');view.unmount();expect(document.documentElement.style.colorScheme).toBe('dark');expect(document.documentElement.style.getPropertyPriority('color-scheme')).toBe('important');document.documentElement.style.removeProperty('color-scheme');
});

it('renders advisory actual-source comparison in the connected trusted status strip without granting writes',async()=>{
 mount();ready();const options=captured.options!;
 options.onSourceObservation?.({remoteDigest:'a'.repeat(64),remoteRevision:'1'});
 expect(await screen.findByText(/Current file bytes have not been verified/)).toBeTruthy();
 options.onLocalSourceEvidence?.('b'.repeat(64));
 expect(await screen.findByText(/Local source has edits\. Publish changes explicitly/)).toBeTruthy();
 options.onSourceObservation?.({remoteDigest:'c'.repeat(64),remoteRevision:'2'});
 expect(await screen.findByText(/Local and remote source changed\. Review both copies/)).toBeTruthy();
 options.onLocalSourceEvidence?.('c'.repeat(64));
 expect(await screen.findByText(/Local and remote source match a newer revision/)).toBeTruthy();
 options.onLocalSourceEvidence?.('a'.repeat(64));
 expect(await screen.findByText(/Remote source is newer\. Local file preserved/)).toBeTruthy();
 options.onState('unavailable');expect(await screen.findByText(/Current remote source is unavailable/)).toBeTruthy();
 expect(annotation.canCreate).toBe(false);expect(broker.authorize).not.toHaveBeenCalled();
});

it('keeps a concise collapsed source summary and exposes its complete explanation in existing controls',async()=>{
 mount();ready();const options=captured.options!;options.onSourceObservation?.({remoteDigest:'a'.repeat(64),remoteRevision:'1'});
 fireEvent.click(await screen.findByRole('button',{name:'Close artifact controls'}));
 const row=screen.getByRole('status',{name:'Local source status'});
 expect(row).toHaveTextContent('File not checked');expect(row).not.toHaveTextContent('Current file bytes');
 options.onLocalSourceEvidence?.('b'.repeat(64));expect(within(row).getByText('Local edits')).toBeTruthy();
 options.onSourceObservation?.({remoteDigest:'c'.repeat(64),remoteRevision:'2'});expect(row).toHaveTextContent('Both changed');
 options.onLocalSourceEvidence?.('c'.repeat(64));expect(row).toHaveTextContent('Copies match');
 expect(screen.queryByText('Local and remote source match a newer revision.')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Open artifact controls'}));
 expect(await screen.findByText('Local and remote source match a newer revision.')).toBeVisible();
 expect(screen.getByText(/File changed remotely\. Open original to review/)).toBeVisible();
 expect(broker.resize).toHaveBeenLastCalledWith({mode:'viewport'});
 fireEvent.click(screen.getByRole('button',{name:'Close artifact controls'}));await waitFor(()=>expect(broker.resize).toHaveBeenLastCalledWith(76));
});
