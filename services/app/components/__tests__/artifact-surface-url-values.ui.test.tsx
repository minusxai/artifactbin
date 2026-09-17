import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {fireEvent,screen,waitFor,act} from '@testing-library/react';
import {render} from '@/test/helpers/surface-ui';
import {setupSurface,surfaceProps} from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
import {declarationsOf} from '@/lib/artifacts';
const source='<Helmet><Value name="region" type="string" default="north" /></Helmet><select aria-label="Region" value="$region"><option value="north">North</option><option value="west">West</option></select>';
const flow=declarationsOf(source)!;
beforeEach(setupSurface);afterEach(()=>vi.unstubAllGlobals());
const props=()=>surfaceProps({source,dataflow:{flow},search:window.location.search});
it('seeds declared typed selections from the URL without exposing unrelated route params',async()=>{
 window.history.replaceState(null,'','/a/story1?$region=west&ref=2&key=nope');
 render(<ArtifactSurface {...props()} />);
 expect(await screen.findByLabelText('Region')).toHaveValue('west');
});
it('uses declaration defaults when the link names no selection',async()=>{
 render(<ArtifactSurface {...props()} />);
 expect(await screen.findByLabelText('Region')).toHaveValue('north');
});
it('writes picks with replace navigation, preserves other params/hash, and keeps the same root',async()=>{
 window.history.replaceState({marker:1},'','/a/story1?ref=2#heading');
 const view=render(<ArtifactSurface {...props()} />);
 const select=await screen.findByLabelText('Region');const root=view.container.querySelector('[data-mx-inline-story]');
 const count=window.history.length;
 fireEvent.change(select,{target:{value:'west'}});
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('$region')).toBe('west'));
 expect(window.location.search).toContain('ref=2');expect(window.location.hash).toBe('#heading');
 expect(window.history.length).toBe(count);expect(view.container.querySelector('[data-mx-inline-story]')).toBe(root);
 fireEvent.change(select,{target:{value:'north'}});
 await waitFor(()=>expect(new URLSearchParams(window.location.search).has('$region')).toBe(false));
});
it('ignores forged URL-value messages from the author realm or any other window',async()=>{
 render(<ArtifactSurface {...props()} />);await screen.findByLabelText('Region');
 await act(async()=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'mx:values',nonce:'forged',values:{region:'west',private:'oops'}}})));
 expect(window.location.search).toBe('');expect(screen.getByLabelText('Region')).toHaveValue('north');
});
