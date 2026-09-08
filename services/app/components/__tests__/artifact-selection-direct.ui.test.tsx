import {act,cleanup,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
import {STORY_SELECTION_ACTION_MESSAGE,STORY_SELECTION_ACTIONS_MESSAGE,STORY_SESSION_MESSAGE} from '@/lib/story-runtime/contract';

vi.mock('@/lib/story-runtime/mount',()=>({mountStory:()=>({adopt:vi.fn(),dispose:vi.fn()})}));
vi.mock('@/components/AnnotationLayer',()=>({default:()=>null}));

const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>Hello</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
const trusted=new WeakSet<Event>();
const trustFirst=(event:Event)=>{if(!trusted.has(event))return;for(const key of Object.getOwnPropertySymbols(event)){const impl=(event as unknown as Record<symbol,{isTrusted?:boolean}>)[key];if(impl&&typeof impl==='object'&&'isTrusted' in impl)impl.isTrusted=true;}};
const dispatchTrustedMessage=(data:unknown)=>{const event=new MessageEvent('message',{data,source:window,origin:window.location.origin});trusted.add(event);act(()=>window.dispatchEvent(event));};

afterEach(()=>{cleanup();window.removeEventListener('message',trustFirst);window.location.hash='';vi.restoreAllMocks();vi.unstubAllGlobals();});

it('grants direct selection actions by capability and rejects a stale nonce',()=>{
 window.addEventListener('message',trustFirst);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 const post=vi.spyOn(window,'postMessage').mockImplementation(()=>{});
 render(<ArtifactShell role="owner"><ArtifactSurface {...props}/></ArtifactShell>);
 const nonce='n'.repeat(32);dispatchTrustedMessage({type:STORY_SESSION_MESSAGE,nonce});
 expect(post.mock.calls.map(call=>call[0]).filter((message:any)=>message?.type===STORY_SELECTION_ACTIONS_MESSAGE).at(-1)).toMatchObject({edit:true,annotate:true});
 dispatchTrustedMessage({type:STORY_SELECTION_ACTION_MESSAGE,nonce:'m'.repeat(32),action:'edit',selection:{kind:'text',path:'0',tag:'p',rect:{x:0,y:0,width:1,height:1},className:'',style:'',ancestors:[]}});
 expect(window.location.hash).toBe('');
 dispatchTrustedMessage({type:STORY_SELECTION_ACTION_MESSAGE,nonce,action:'edit',selection:{kind:'text',path:'0',tag:'p',rect:{x:0,y:0,width:1,height:1},className:'',style:'',ancestors:[]}});
 expect(window.location.hash).toBe('#edit');
});

it('advertises and enforces read-only selection capabilities',()=>{
 window.addEventListener('message',trustFirst);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 const post=vi.spyOn(window,'postMessage').mockImplementation(()=>{});
 render(<ArtifactShell role="viewer"><ArtifactSurface {...props}/></ArtifactShell>);
 const nonce='n'.repeat(32);dispatchTrustedMessage({type:STORY_SESSION_MESSAGE,nonce});
 expect(post.mock.calls.map(call=>call[0]).filter((message:any)=>message?.type===STORY_SELECTION_ACTIONS_MESSAGE).at(-1)).toMatchObject({edit:false,annotate:false});
 dispatchTrustedMessage({type:STORY_SELECTION_ACTION_MESSAGE,nonce,action:'edit',selection:{kind:'text',path:'0',tag:'p',rect:{x:0,y:0,width:1,height:1},className:'',style:'',ancestors:[]}});
 expect(window.location.hash).toBe('');
});
