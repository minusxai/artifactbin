import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import MdxArtifactEditor from '../MdxArtifactEditor';
import {parseDocumentMdx} from '@/lib/document/mdx';
import type {EditorFlushRef} from '@/lib/story/use-live-edits';
vi.mock('@/lib/story/use-versions',()=>({useArtifactVersions:()=>({versions:[]})}));
afterEach(()=>vi.unstubAllGlobals());
it('prevents exiting while source changes are unapplied and keeps the draft visible',async()=>{
 const snapshot={id:'abc123',version:1,document:parseDocumentMdx('Hello')};
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>snapshot})));
 const flushRef:EditorFlushRef={current:null};const done=vi.fn();
 render(<MdxArtifactEditor id="abc123" snapshot={snapshot} compiledCss={null} flushRef={flushRef} onDone={done}/>);
 await act(async()=>{await Promise.resolve();});fireEvent.click(screen.getByRole('button',{name:'MDX source'}));
 fireEvent.change(screen.getByRole('textbox',{name:'MDX source'}),{target:{value:'My source draft'}});
 await act(async()=>{await expect(flushRef.current!()).rejects.toThrow('Apply your source changes');});
 expect((screen.getByRole('textbox',{name:'MDX source'}) as HTMLTextAreaElement).value).toBe('My source draft');expect(done).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Apply MDX'}));await waitFor(()=>expect(screen.queryByRole('textbox',{name:'MDX source'})).toBeNull());
});
