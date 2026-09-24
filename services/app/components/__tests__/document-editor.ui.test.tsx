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
 expect(screen.getByRole('button',{name:'Resize layout divider 1'})).toBeTruthy();expect(onChange).not.toHaveBeenCalled();
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
