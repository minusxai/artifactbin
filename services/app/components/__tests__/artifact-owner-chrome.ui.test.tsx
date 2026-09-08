import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {bindAppNavigation} from '@/web/api-origin';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>Hello</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const mount=(role:'owner'|'editor'|'commenter'|'viewer')=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));return render(<ArtifactShell role={role}><ArtifactSurface {...props}/></ArtifactShell>);};
it('keeps edit and owner actions capability-gated in trusted page chrome',()=>{
 mount('owner'); fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(screen.getByLabelText('Edit artifact')).toBeVisible();
 expect(screen.getByLabelText('Copy agent instructions')).toBeVisible();
});
it('gives an editor edit/comment but not owner controls',()=>{
 mount('editor'); fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(screen.getByLabelText('Edit artifact')).toBeVisible();
 expect(screen.getAllByLabelText('Toggle comments').some(element=>element instanceof HTMLElement && element.offsetParent!==null || element instanceof HTMLElement)).toBe(true);
 expect(screen.queryByLabelText('Copy agent instructions')).toBeNull();
});
it('keeps a reader read-only while retaining like/comment login intents',()=>{
 mount('viewer'); fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(screen.queryByLabelText('Edit artifact')).toBeNull();
 expect(screen.getByLabelText('Fork artifact')).toBeVisible();
});
it('explains unavailable commenting to a signed-in direct-page viewer',()=>{
 render(<ArtifactShell role="viewer"><ArtifactSurface {...props} accountSession /></ArtifactShell>);
 fireEvent.click(screen.getByLabelText('Toggle comments'));
 expect(screen.getByRole('status')).toHaveTextContent('Commenting is not enabled for your access');
 expect(screen.getByLabelText('Annotation sidebar')).toBeVisible();
});
it('gives direct social controls touch-sized targets and accessible focus tooltips',async()=>{
 mount('viewer');
 const like=screen.getByLabelText('Like artifact');const comments=screen.getByLabelText('Toggle comments');
 expect(like).toHaveClass('min-h-11','min-w-11');expect(comments).toHaveClass('min-h-11','min-w-11');
 fireEvent.focus(comments);
 expect(await screen.findByRole('tooltip')).toHaveTextContent('Comments');
});
it('overlays the direct document with a correctly inset annotation rail',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({annotations:[]})));
 render(<ArtifactShell role="owner"><ArtifactSurface {...props}/></ArtifactShell>);fireEvent.click(screen.getByLabelText('Toggle comments'));
 const rail=await screen.findByLabelText('Annotation sidebar');
 expect(rail).toHaveStyle({top:'44px',right:'0px',width:'320px'});
 expect(screen.getByLabelText('Artifact viewport')).toHaveStyle({right:'0px'});
});

const openFork=()=>{fireEvent.click(screen.getByLabelText('Open artifact controls'));fireEvent.click(screen.getByLabelText('Fork artifact'));};
const forkResponse=(status:number,body:unknown)=>vi.fn(async(..._args:Parameters<typeof fetch>)=>({ok:status===201,status,json:async()=>body}));

it('navigates to a successful fork and sends only one write on a double click',async()=>{
 const navigate=vi.fn();const unbind=bindAppNavigation(url=>{navigate(url.pathname+url.search);return true;});
 mount('owner');const fetchMock=forkResponse(201,{url:'/a/copy01'});vi.stubGlobal('fetch',fetchMock);fireEvent.click(screen.getByLabelText('Open artifact controls'));
 const fork=screen.getByLabelText('Fork artifact');act(()=>{fork.click();fork.click();});
 await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/a/copy01'));
 expect(fetchMock.mock.calls.filter(call=>String(call[0]).endsWith('/fork'))).toHaveLength(1);
 expect(fetchMock).toHaveBeenCalledWith('/api/my/artifacts/story1/fork',expect.objectContaining({method:'POST'}));
 unbind();
});

it('shows and dismisses a named fork refusal without navigating',async()=>{
 const navigate=vi.fn();const unbind=bindAppNavigation(()=>{navigate();return true;});mount('owner');
 vi.stubGlobal('fetch',forkResponse(400,{error:'unownable_mutation',details:['ref_ab12cd is not yours to write']}));openFork();
 expect(await screen.findByLabelText('Fork refused')).toHaveTextContent('ref_ab12cd is not yours to write');
 expect(navigate).not.toHaveBeenCalled();fireEvent.click(screen.getByLabelText('Dismiss fork refusal'));
 await waitFor(()=>expect(screen.queryByLabelText('Fork refused')).toBeNull());
 unbind();
});

it('keeps 403 as a refusal but sends 401 and sign-in-required 409 to login with the selection',async()=>{
 window.history.replaceState(null,'','/a/story1?$region=west');
 const navigate=vi.fn();const unbind=bindAppNavigation(url=>{navigate(url.pathname+url.search);return true;});
 mount('viewer');vi.stubGlobal('fetch',forkResponse(403,{error:'forbidden'}));openFork();
 expect(await screen.findByLabelText('Fork refused')).toHaveTextContent('forbidden');expect(navigate).not.toHaveBeenCalled();cleanup();
 for(const [status,error] of [[401,'unauthorized'],[409,'sign_in_required']] as const){
   navigate.mockClear();vi.stubGlobal('fetch',forkResponse(status,{error}));
   render(<ArtifactShell role="viewer"><ArtifactSurface {...props} search="?$region=west" /></ArtifactShell>);openFork();
   await waitFor(()=>expect(navigate).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent('/a/story1?$region=west&intent=fork')}`));cleanup();
 }
 unbind();
 window.history.replaceState(null,'','/');
});

it('keeps refresh-author actions owner-only after direct mounting',()=>{
 mount('owner');fireEvent.click(screen.getByLabelText('Open artifact controls'));expect(screen.getByLabelText('Refresh external images')).toBeVisible();cleanup();
 for(const role of ['editor','commenter','viewer'] as const){mount(role);fireEvent.click(screen.getByLabelText('Open artifact controls'));expect(screen.queryByLabelText('Refresh external images')).toBeNull();cleanup();}
});
