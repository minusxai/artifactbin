import {EditorView} from 'prosemirror-view';
import {createDocumentEditorState} from '@/lib/document/editor';
import {dimensionPreview} from '@/lib/document/editor-layout';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {DocumentEditor} from '../DocumentEditor';
import {parseDocumentMdx} from '@/lib/document/mdx';
it('renders one editor across prose and nested layouts without emitting visual mutations',async()=>{
 const onChange=vi.fn();const document=parseDocumentMdx('<Flex direction="row" sizes={[1,1]}>\n\nLeft\n\nRight\n\n</Flex>');
 const result=render(<DocumentEditor document={document} onChange={onChange}/>);
 await act(async()=>{await Promise.resolve();});
 expect(screen.getAllByRole('textbox',{name:'Document editor'})).toHaveLength(1);
 expect(screen.getByText('Left')).toBeTruthy();expect(screen.getByText('Right')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Resize layout divider 1'})).toBeNull();expect(onChange).not.toHaveBeenCalled();
 result.unmount();
});
it('inserts a layout through the toolbar and emits a canonical document',async()=>{
 const onChange=vi.fn();render(<DocumentEditor document={parseDocumentMdx('Hello')} onChange={onChange}/>);
 fireEvent.click(screen.getByRole('button',{name:'Insert columns'}));
 await waitFor(()=>expect(onChange).toHaveBeenCalled());
 expect(Object.values(onChange.mock.lastCall![0].nodes).some((n:unknown)=>(n as {name?:string}).name==='Flex')).toBe(true);
});
it('keeps the editor DOM when its parent acknowledges a change',()=>{
 const document=parseDocumentMdx('Hello');const {rerender}=render(<DocumentEditor document={document} onChange={()=>{}}/>);
 const original=screen.getByRole('textbox',{name:'Document editor'});
 rerender(<DocumentEditor document={structuredClone(document)} onChange={()=>{}}/>);
 expect(screen.getByRole('textbox',{name:'Document editor'})).toBe(original);
});
it('keeps component selection through successive dimension and float edits',async()=>{
 const onChange=vi.fn();render(<DocumentEditor document={parseDocumentMdx('Before <img src="https://example.com/image.png" /> after')} onChange={onChange}/>);
 fireEvent.mouseDown(screen.getByRole('button',{name:'Select img'}));
 for(const value of ['3','32','320'])fireEvent.change(screen.getByRole('spinbutton',{name:'Component width'}),{target:{value}});
 fireEvent.change(screen.getByRole('combobox',{name:'Float component'}),{target:{value:'left'}});
 await waitFor(()=>expect(onChange).toHaveBeenCalled());
 const image=Object.values(onChange.mock.lastCall![0].nodes).find((n:unknown)=>(n as {tag?:string}).tag==='img') as {props:unknown};expect(image.props).toMatchObject({width:320,float:'left'});
});
it('renders reactive inline expressions from the document declarations',async()=>{
 render(<DocumentEditor document={parseDocumentMdx('<Helmet><Value name="total" type="number" default={42} /></Helmet>\n\nTotal: {$total}')} onChange={()=>{}}/>);
 await waitFor(()=>expect(screen.getByText('42')).toBeTruthy());
});
it('supports keyboard sizing and does not edit when readonly',async()=>{
 const onChange=vi.fn();const document=parseDocumentMdx('<Iframe title="Demo" width={240} height={160}><p>Hello</p></Iframe>');
 const {rerender}=render(<DocumentEditor document={document} onChange={onChange}/>);
 fireEvent.keyDown(screen.getByRole('button',{name:'Resize component'}),{key:'ArrowRight'});
 await waitFor(()=>expect(onChange).toHaveBeenCalled());
 expect(Object.values(onChange.mock.lastCall![0].nodes).find((n:unknown)=>(n as {name?:string}).name==='Iframe')).toMatchObject({props:{width:250,height:160}});
 onChange.mockClear();rerender(<DocumentEditor document={document} onChange={onChange} editable={false}/>);
 fireEvent.keyDown(screen.getByLabelText('Resize component'),{key:'ArrowRight'});expect(onChange).not.toHaveBeenCalled();
});

it('puts divider handles in their own boundary layer and gives the parent a separate resize handle',async()=>{
 const onChange=vi.fn();render(<DocumentEditor document={parseDocumentMdx('<Flex direction="row" sizes={[2,1]}>\n\n<div>Left</div>\n\n<div>Right</div>\n\n</Flex>')} onChange={onChange}/>);
 await act(async()=>{await Promise.resolve();});
 expect(screen.queryByRole('button',{name:'Resize layout divider 1'})).toBeNull();
 fireEvent.mouseDown(screen.getByRole('button',{name:'Select Flex'}));
 const divider=screen.getByRole('button',{name:'Resize layout divider 1'});
 expect(divider.parentElement?.className).toBe('mdx-layout-dividers');
 expect(screen.getAllByRole('button',{name:'Resize container'}).length).toBe(3);
 fireEvent.mouseDown(screen.getAllByRole('button',{name:'Select container'})[0]);
 expect(screen.queryByRole('button',{name:'Resize layout divider 1'})).toBeNull();
 fireEvent.change(screen.getByRole('spinbutton',{name:'Width of parent (%)'}),{target:{value:'50'}});
 const next=onChange.mock.lastCall![0];expect(Object.values(next.nodes).find((n:unknown)=>(n as {name?:string}).name==='Flex')).toMatchObject({props:{sizes:[1.5,1.5]}});
 fireEvent.change(screen.getByRole('spinbutton',{name:'Width of parent (%)'}),{target:{value:'3'}});expect((screen.getByRole('spinbutton',{name:'Width of parent (%)'}) as HTMLInputElement).value).toBe('3');
});

it('keeps native dragging enabled when selecting a component handle',()=>{
 render(<DocumentEditor document={parseDocumentMdx('<Iframe title="Demo"><p>Hello</p></Iframe>')} onChange={()=>{}}/>);
 const event=new MouseEvent('mousedown',{bubbles:true,cancelable:true});
 screen.getByRole('button',{name:'Select Iframe'}).dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});

it('wraps the current Markdown in a styled block without an HTML workflow',async()=>{
 const onChange=vi.fn();render(<DocumentEditor document={parseDocumentMdx('Keep writing here')} onChange={onChange}/>);
 expect(screen.queryByRole('button',{name:'Insert iframe'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Style block'}));
 await waitFor(()=>expect(onChange).toHaveBeenCalled());
 const next=onChange.mock.lastCall![0];const block=next.nodes[next.nodes[next.rootId].children[0]];
 expect(block).toMatchObject({type:'html',tag:'div'});
 expect(next.nodes[block.children[0]].content[0].text).toBe('Keep writing here');
});
it('applies a container class to the editable content itself',async()=>{
 render(<DocumentEditor document={parseDocumentMdx('<div className="font-mono">\n\nStyled prose\n\nAnother paragraph\n\n</div>')} onChange={()=>{}}/>);
 await act(async()=>{await Promise.resolve();});
 expect(screen.getByText('Styled prose').closest('.mdx-container-content')?.classList.contains('font-mono')).toBe(true);
});
it('refreshes percentage after a committed resize has reached the DOM',async()=>{
 const measure=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const width=this.style.width?parseFloat(this.style.width):1000;return {left:0,top:0,right:width,bottom:100,width,height:100,x:0,y:0,toJSON:()=>({})};});
 try{
  render(<DocumentEditor document={parseDocumentMdx('<div width={240}>\n\nOne\n\nTwo\n\n</div>')} onChange={()=>{}}/>);
  await act(async()=>{await Promise.resolve();});fireEvent.mouseDown(screen.getByRole('button',{name:'Select container'}));
  fireEvent.change(screen.getByRole('spinbutton',{name:'Component width'}),{target:{value:'320'}});
  await waitFor(()=>expect((screen.getByRole('spinbutton',{name:'Width of parent (%)'}) as HTMLInputElement).value).toBe('32'));
 }finally{measure.mockRestore();}
});

it('offers user formatting without a text CSS class field',()=>{
 render(<DocumentEditor document={parseDocumentMdx('Hello')} onChange={()=>{}}/>);
 expect(screen.queryByRole('textbox',{name:'Text CSS class'})).toBeNull();
 expect(screen.getByRole('combobox',{name:'Text font'})).toBeTruthy();
});

it('disables unavailable undo and redo as edits move through history',async()=>{
 // jsdom has no range geometry; ProseMirror scrolls the restored selection.
 const rects=Object.getOwnPropertyDescriptor(Range.prototype,'getClientRects');
 Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[new DOMRect(0,0,10,10)]});
 try{
 render(<DocumentEditor document={parseDocumentMdx('Hello')} onChange={()=>{}}/>);
 expect((screen.getByRole('button',{name:'Undo'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Redo'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Style block'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'Undo'}) as HTMLButtonElement).disabled).toBe(false));expect((screen.getByRole('button',{name:'Redo'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Undo'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Undo'}) as HTMLButtonElement).disabled).toBe(true));expect((screen.getByRole('button',{name:'Redo'}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Redo'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Undo'}) as HTMLButtonElement).disabled).toBe(false));expect((screen.getByRole('button',{name:'Redo'}) as HTMLButtonElement).disabled).toBe(true);
 }finally{if(rects)Object.defineProperty(Range.prototype,'getClientRects',rects);else Reflect.deleteProperty(Range.prototype,'getClientRects');}
});

it('previews the styled content height before committing and restores it on cancellation',()=>{
 const view=new EditorView(document.createElement('div'),{state:createDocumentEditorState(parseDocumentMdx('Hello'))});
 const dom=document.createElement('div'),content=document.createElement('div');dom.append(content);content.className='mdx-container-content';dom.style.minHeight=content.style.minHeight='363px';
 try{
  const preview=dimensionPreview(view,0,dom);preview.update(462,144);
  expect(content.style.minHeight).toBe('144px');expect(dom.style.minHeight).toBe('144px');
  preview.update(462,420);expect(content.style.minHeight).toBe('420px');
  preview.clear();expect(content.style.minHeight).toBe('363px');expect(dom.style.minHeight).toBe('363px');
 }finally{view.destroy();}
});

it('refreshes selected properties when returning from a version preview',async()=>{
 const document=parseDocumentMdx('<div height={420}>\n\nOne\n\nTwo\n\n</div>');const next=structuredClone(document);const id=document.nodes[document.rootId].children![0];next.nodes[id].props!.height=180;
 const {rerender}=render(<DocumentEditor document={document} onChange={()=>{}}/>);
 await act(async()=>{await Promise.resolve();});fireEvent.mouseDown(screen.getByRole('button',{name:'Select container'}));
 expect((screen.getByRole('spinbutton',{name:'Component height'}) as HTMLInputElement).value).toBe('420');
 rerender(<DocumentEditor document={next} onChange={()=>{}}/>);
 await waitFor(()=>expect((screen.getByRole('spinbutton',{name:'Component height'}) as HTMLInputElement).value).toBe('180'));
});

it('preserves authored canvas tags, ids and direct-child layout without editor wrappers',async()=>{
 const document=parseDocumentMdx('<section id="story" className="relative">\n\n<div id="card" className="absolute">\n\n## Editable heading\n\nEditable body.\n\n</div>\n\n</section>');document.nodes[document.rootId].props.layout='canvas';
 render(<DocumentEditor document={document} onChange={()=>{}}/>);await act(async()=>{await Promise.resolve();});
 const editor=screen.getByRole('textbox',{name:'Document editor'});expect(editor.querySelector('section#story.relative > div#card.absolute > h2')?.textContent).toBe('Editable heading');
 expect(editor.querySelector('.mdx-container-content')).toBeNull();
});

it('resizes canvas nodes outside authored DOM and cancels a preview without saving',async()=>{
 const measure=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const width=parseFloat(this.style.width)||240,height=parseFloat(this.style.height)||360;return new DOMRect(0,0,width,height);});
 try{
  const document=parseDocumentMdx('<div width={240} height={360}>\n\nOne\n\nTwo\n\n</div>');document.nodes[document.rootId].props.layout='canvas';const onChange=vi.fn();render(<DocumentEditor document={document} onChange={onChange}/>);
  const block=screen.getByText('One').parentElement!;fireEvent.mouseMove(block);fireEvent.mouseDown(screen.getByRole('button',{name:'Select block'}));
  const handle=screen.getByRole('button',{name:'Resize selected block height'}) as HTMLButtonElement;handle.setPointerCapture=vi.fn();
  expect(screen.getByRole('textbox',{name:'Document editor'}).contains(handle)).toBe(false);
  handle.onpointerdown!(new MouseEvent('pointerdown',{clientX:0,clientY:360}) as PointerEvent);fireEvent(handle,new MouseEvent('pointermove',{clientX:0,clientY:280}));expect(block.style.height).toBe('280px');
  fireEvent(handle,new MouseEvent('pointercancel'));expect(block.style.height).toBe('360px');expect(onChange).not.toHaveBeenCalled();
  handle.onpointerdown!(new MouseEvent('pointerdown',{clientX:0,clientY:360}) as PointerEvent);fireEvent(handle,new MouseEvent('pointermove',{clientX:0,clientY:300}));fireEvent(handle,new MouseEvent('pointerup'));
  await waitFor(()=>expect(onChange).toHaveBeenCalled());const next=onChange.mock.lastCall![0];expect(next.nodes[next.nodes[next.rootId].children[0]].props.height).toBe(300);
 }finally{measure.mockRestore();}
});
