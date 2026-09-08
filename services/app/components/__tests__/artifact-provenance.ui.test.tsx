import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {fireEvent,screen} from '@testing-library/react';
import {render} from '@/test/helpers/surface-ui';
import {surfaceProps,setupSurface} from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
beforeEach(setupSurface);afterEach(()=>vi.unstubAllGlobals());
it.each([{label:'Public source',href:'/a/source1'},{label:'a private document',href:null}])('shows server-redacted fork provenance in settings: $label',async(forkedFrom)=>{
 const view=render(<ArtifactSurface {...surfaceProps()} author={{username:'author',forkedFrom}} />);
 await screen.findByText('Document body');fireEvent.click(screen.getByLabelText('Open artifact controls'));
 const line=view.container.querySelector('[data-mx-forked-from]');
 expect(line).toHaveTextContent('forked from '+forkedFrom.label);
 if(forkedFrom.href)expect(screen.getByLabelText('Open the artifact this was forked from')).toHaveAttribute('href',forkedFrom.href);
 else expect(line?.querySelector('a')).toBeNull();
});
