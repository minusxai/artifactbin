import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { act,screen } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface,surfaceProps,SurfaceEvents } from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
beforeEach(setupSurface);afterEach(()=>vi.unstubAllGlobals());
it.each(['visibilitychange','pageshow'])('preserves document DOM on %s instead of probing or replacing a full-document frame',async(type)=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);
 const paragraph=await screen.findByText('Document body');
 const root=view.container.querySelector('[data-mx-inline-story]');
 const post=vi.spyOn(window,'postMessage');
 act(()=>{document.dispatchEvent(new Event(type));window.dispatchEvent(new Event(type));});
 expect(screen.getByText('Document body')).toBe(paragraph);
 expect(view.container.querySelector('[data-mx-inline-story]')).toBe(root);
 expect(post).not.toHaveBeenCalled();post.mockRestore();
});
it('closes the owned stream and removes document DOM and styles on unmount',async()=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 const stream=SurfaceEvents.last;view.unmount();
 expect(stream.close).toHaveBeenCalled();
 expect(document.querySelector('[data-mx-inline-story]')).toBeNull();
});
