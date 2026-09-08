import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import * as api from '@/web/api-origin';
import ArtifactSurface, {type ArtifactSurfaceProps} from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';

const layers: Array<Record<string,unknown>>=[];
vi.mock('@/components/AnnotationLayer',()=>({default:(props:Record<string,unknown>)=>{layers.push(props);return null;}}));
const origin='https://artifactbin.test';
const props:ArtifactSurfaceProps={id:'abc123',editId:'edit1',format:'markup',title:'Test',source:null,template:null,refs:[],version:1,content:'<p>Test</p>',columns:[],compiledCss:null,theme:null,colorMode:null,controlsOnly:true,accountSession:true};
const address=(url:string,source:MessageEventSource|null=window.parent,from=origin)=>act(()=>api.receiveArtifactAddress(new MessageEvent('message',{source,origin:from,data:{type:'mx:controls:address',url}})));
function setup() {
  vi.stubGlobal('EventSource',class {addEventListener(){} removeEventListener(){} close(){}});
  window.history.replaceState(null,'','/controls/a/abc123');
  api.configureAppApi(window.location.origin,origin,'controls');
  return vi.spyOn(api,'appNavigate').mockImplementation(()=>{});
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();layers.length=0;});
it('shows enabled trusted reader actions as pointer controls',()=>{
  setup();
  render(<ArtifactShell role="viewer"><ArtifactSurface {...props} follow={{userId:'owner',following:false,count:0}}/></ArtifactShell>);
  for(const label of ['Like artifact','Toggle comments','Follow author'])expect(screen.getByLabelText(label)).toHaveClass('cursor-pointer');
});
it.each([['Like artifact','like',401],['Like artifact','like',403],['Follow author','follow',401],['Follow author','follow',403]] as const)('%s handles %s response %s without permission/login confusion',async(label,intent,status)=>{
  const navigate=setup();
  const request=vi.fn(async()=>new Response('{}',{status}));vi.stubGlobal('fetch',request);
  render(<ArtifactShell role="viewer"><ArtifactSurface {...props} follow={{userId:'owner',following:false,count:0}}/></ArtifactShell>);
  address(`${origin}/a/abc123?$x=west#section`);
  fireEvent.click(screen.getByLabelText(label));
  await waitFor(()=>expect(request).toHaveBeenCalled());
  if(status===401) await waitFor(()=>expect(navigate).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent(`/a/abc123?$x=west&intent=${intent}#section`)}`));
  else {await act(async()=>{});expect(navigate).not.toHaveBeenCalled();}
});
it('waits for a validated parent address, confirms a fork once, and preserves current values/hash at login',()=>{
  const navigate=setup();
  render(<ArtifactShell role="viewer"><ArtifactSurface {...props} accountSession={false}/></ArtifactShell>);
  expect(screen.queryByLabelText('Fork this artifact')).toBeNull();
  address(`${origin}/@me/abc123-test?intent=fork&$x=west#one`,null);
  address(`${origin}/@me/abc123-test?intent=fork` ,window.parent,'null');
  address('https://evil.test/a/abc123?intent=fork');
  expect(screen.queryByLabelText('Fork this artifact')).toBeNull();
  address(`${origin}/@me/abc123-test?intent=fork&$x=west#one`);
  expect(screen.getByLabelText('Fork this artifact')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Cancel fork'));
  address(`${origin}/@me/abc123-test?intent=fork&$x=east#two`);
  expect(screen.queryByLabelText('Fork this artifact')).toBeNull();
  fireEvent.click(screen.getByLabelText('Like artifact'));
  expect(navigate).toHaveBeenLastCalledWith(`/login?callbackUrl=${encodeURIComponent('/@me/abc123-test?$x=east&intent=like#two')}`);
});
it('opens the comments rail after login without posting; a viewer gains no annotation permission',()=>{
  setup();
  const rendered=render(<ArtifactShell role="commenter"><ArtifactSurface {...props}/></ArtifactShell>);
  address(`${origin}/a/abc123?intent=comment`);
  expect(layers.at(-1)?.railOpen).toBe(true);
  rendered.unmount();layers.length=0;
  setup();
  render(<ArtifactShell role="viewer"><ArtifactSurface {...props}/></ArtifactShell>);
  address(`${origin}/a/abc123?intent=comment`);
  expect(layers).toHaveLength(0);
  expect(screen.getByLabelText('Toggle comments').querySelector('.lucide-message-square')).toBeTruthy();
  expect(screen.getByLabelText('Annotation sidebar')).toHaveTextContent('Commenting is not enabled for your access');
});
