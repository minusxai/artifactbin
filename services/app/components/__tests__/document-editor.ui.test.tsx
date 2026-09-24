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
