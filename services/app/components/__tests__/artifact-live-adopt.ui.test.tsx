import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {act,screen,waitFor} from '@testing-library/react';
import {render} from '@/test/helpers/surface-ui';
import {setupSurface,surfaceProps,SurfaceEvents} from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import {parseJsx} from '@/lib/jsx';
import type {ArtifactLiveEvent} from '@/lib/story/live';
let served:ArtifactLiveEvent;
function version(source:string,over:Partial<ArtifactLiveEvent>={}):ArtifactLiveEvent{
 const parsed=parseJsx(source);if(!parsed.ok)throw Error(parsed.error);
 return {editId:'edit_2',version:2,format:'markup',title:'Document',source,content:null,theme:null,colorMode:null,template:null,nodes:parsed.nodes,...over} as ArtifactLiveEvent;
}
beforeEach(()=>{setupSurface();vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
 if(String(url).endsWith('/events/frame'))return new Response(JSON.stringify(served));
 throw Error('unexpected fetch '+url);
}));});afterEach(()=>vi.unstubAllGlobals());
async function update(over:Partial<ArtifactLiveEvent>={}){
 served=version('<p>Second version</p>',over);
 await act(async()=>{SurfaceEvents.last.onmessage?.({data:JSON.stringify({editId:served.editId,version:served.version,by:null})} as MessageEvent);});
}
it('adopts a new version into the existing DOM root without a frame, paint handshake or loading flash',async()=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 const root=view.container.querySelector('[data-mx-inline-story]');
 await update();await screen.findByText('Second version');
 expect(view.container.querySelector('[data-mx-inline-story]')).toBe(root);
 expect(screen.queryByLabelText('Loading document')).toBeNull();
 expect(screen.queryByText('Document body')).toBeNull();
});
it('updates owned styles and color mode together with source',async()=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 await update({compiledCss:'.changed{color:red}',authorCss:'.authored{margin:3px}',theme:'modernist' as never,colorMode:'dark'});
 await screen.findByText('Second version');
 const root=view.container.querySelector('[data-mx-inline-story]')!;
 expect(root).toHaveClass('dark');expect(root).toHaveAttribute('data-theme','modernist');
 expect(root.querySelector('style')?.textContent).toContain('.changed');
 expect(root.querySelector('style')?.textContent).toContain('.authored');
});
it('ignores an invalid replacement rather than discarding the still-readable document',async()=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 const root=view.container.querySelector('[data-mx-inline-story]');
 await update({source:'<not valid',nodes:undefined});
 await waitFor(()=>expect(fetch).toHaveBeenCalled());
 expect(view.container.querySelector('[data-mx-inline-story]')).toBe(root);
 expect(screen.getByText('Document body')).toBeInTheDocument();
});

it('warms editing code only for a viewer who may edit, and cancels it on permission loss', async () => {
  const idle = vi.fn(() => 42), cancel = vi.fn();
  vi.stubGlobal('requestIdleCallback', idle); vi.stubGlobal('cancelIdleCallback', cancel);
  const view = render(<ArtifactShell role="viewer"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
  await screen.findByText('Document body');
  expect(idle).not.toHaveBeenCalled();
  view.rerender(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
  expect(idle).toHaveBeenCalledOnce();
  view.rerender(<ArtifactShell role="viewer"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
  expect(cancel).toHaveBeenCalledWith(42);
});
