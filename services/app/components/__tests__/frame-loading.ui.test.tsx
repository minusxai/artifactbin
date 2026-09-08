import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface,surfaceProps } from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
beforeEach(setupSurface);afterEach(()=>vi.unstubAllGlobals());
it('reveals the top-level document after its lazy runtime mounts, without a full-document frame',async()=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);
 expect(await screen.findByText('Document body')).toBeInTheDocument();
 expect(view.container.querySelector('[data-mx-inline-story]')).not.toBeNull();
 expect(screen.queryByTitle('artifact')).toBeNull();
 expect(screen.queryByLabelText('Loading document')).toBeNull();
});
it('keeps the document ground dark during and after runtime startup',async()=>{
 render(<ArtifactSurface {...surfaceProps({colorMode:'dark'})} />);
 const viewport=screen.getByLabelText('Artifact viewport');
 const ground=viewport.style.background;
 expect(ground).not.toBe('');
 await screen.findByText('Document body');
 expect(viewport.style.background).toBe(ground);
 expect(viewport.querySelector('[data-mx-inline-story]')).toHaveClass('dark');
});
