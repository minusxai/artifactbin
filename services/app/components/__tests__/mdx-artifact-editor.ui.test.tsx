import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import MdxArtifactEditor from '../MdxArtifactEditor';
import {parseDocumentMdx} from '@/lib/document/mdx';
import type {EditorFlushRef} from '@/lib/story/use-live-edits';
const history=vi.hoisted(()=>({versions:[] as Array<{version:number;title:string;description:null;format:string;by:null;created_at:string}>,fetchVersion:vi.fn(),refresh:vi.fn()}));
vi.mock('@/lib/story/use-versions',()=>({useArtifactVersions:()=>history}));
function rail(){const root=document.querySelector('[data-trusted-ui]')!.shadowRoot!.querySelector<HTMLElement>('[data-trusted-ui-root]')!;root.style.display='block';return within(root);}
beforeEach(()=>{history.versions=[];history.fetchVersion.mockReset();});
afterEach(()=>vi.unstubAllGlobals());
it('prevents exiting while source changes are unapplied and keeps the draft visible',async()=>{
 const snapshot={id:'abc123',version:1,document:parseDocumentMdx('Hello')};
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>snapshot})));
 const flushRef:EditorFlushRef={current:null};const done=vi.fn();
 render(<MdxArtifactEditor id="abc123" snapshot={snapshot} compiledCss={null} flushRef={flushRef} onDone={done}/>);
 await act(async()=>{await Promise.resolve();});fireEvent.click(rail().getByRole('button',{name:'Edit the source'}));
 fireEvent.change(screen.getByRole('textbox',{name:'MDX source'}),{target:{value:'My source draft'}});
 await act(async()=>{await expect(flushRef.current!()).rejects.toThrow('Apply your source changes');});
 expect((screen.getByRole('textbox',{name:'MDX source'}) as HTMLTextAreaElement).value).toBe('My source draft');expect(done).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Apply MDX'}));await waitFor(()=>expect(screen.queryByRole('textbox',{name:'MDX source'})).toBeNull());
});

it('keeps history in the existing left rail and previews and restores in place',async()=>{
 const past=parseDocumentMdx('Original text');const current=structuredClone(past);const nodeId=past.nodes[past.rootId].children![0];current.nodes[nodeId].content![0]={type:'text',text:'Current text',marks:[]};
 const snapshot={id:'abc123',version:2,document:current};
 history.versions=[{version:1,title:'Original',description:null,format:'markup',by:null,created_at:new Date().toISOString()}];history.fetchVersion.mockResolvedValue({version:1,document:past});
 const calls:unknown[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{if(init?.method==='PATCH'){calls.push(JSON.parse(String(init.body)));return {ok:true,json:async()=>({updated:true,version:3,document:past})};}return {ok:true,json:async()=>snapshot};}));
 const open=vi.spyOn(window,'open');
 try{
  render(<MdxArtifactEditor id="abc123" snapshot={snapshot} compiledCss={null} flushRef={{current:null}} onDone={()=>{}}/>);
  expect(rail().getByRole('navigation',{name:'Artifact parts'}).contains(rail().getByRole('region',{name:'Version history'}))).toBe(true);
  fireEvent.click(rail().getByRole('button',{name:'Preview version 1'}));
  await waitFor(()=>expect(screen.getByText('Original text')).toBeTruthy());expect(open).not.toHaveBeenCalled();expect(calls).toHaveLength(0);
  expect(screen.getByRole('textbox',{name:'Document editor'}).getAttribute('contenteditable')).toBe('false');
  fireEvent.click(rail().getByRole('button',{name:'Show the current version'}));await waitFor(()=>expect(screen.getByText('Current text')).toBeTruthy());
  fireEvent.click(rail().getByRole('button',{name:'Preview version 1'}));await rail().findByRole('button',{name:'Restore version 1'});
  fireEvent.click(rail().getByRole('button',{name:'Restore version 1'}));await waitFor(()=>expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({baseVersion:2,changedIds:[nodeId],operations:expect.any(Array)});
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Document editor'}).getAttribute('contenteditable')).toBe('true'));
 }finally{open.mockRestore();}
});
