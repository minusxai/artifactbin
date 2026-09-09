import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { screen,fireEvent } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface,surfaceProps } from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
beforeEach(setupSurface);afterEach(()=>vi.unstubAllGlobals());
it('renders authored DOM in the parent, never a full-document /raw iframe',async()=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 expect(view.container.querySelector('[data-mx-inline-story] p')).toHaveTextContent('Document body');
 expect(view.container.querySelector('[data-mx-inline-story] iframe')).toBeNull();
 expect(view.container.querySelector('iframe[src*="/raw"]')).toBeNull();
 expect(view.container.innerHTML).not.toContain('/raw?key=');
});
it('keeps owner controls while readers cannot enter editing',async()=>{
 const view=render(<ArtifactSurface {...surfaceProps()} />);await screen.findByText('Document body');
 expect(screen.queryByLabelText('Edit artifact')).toBeNull();view.unmount();
 render(<ArtifactShell role="owner"><ArtifactSurface {...surfaceProps()} /></ArtifactShell>);
 await screen.findByText('Document body');fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(screen.getByLabelText('Edit artifact')).toBeInTheDocument();
});
