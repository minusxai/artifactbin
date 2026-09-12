import { render,screen,fireEvent,act } from '@testing-library/react';
import { expect,it,vi,afterEach } from 'vitest';
import { InlineReaderChrome } from '../InlineReaderChrome';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shows copied-link feedback after clipboard sharing',async()=>{
 const writeText=vi.fn(async()=>{});vi.stubGlobal('navigator',{clipboard:{writeText}});
 const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:null,share:true}} onAction={vi.fn()} />);
 await act(async()=>fireEvent.click(screen.getByLabelText('Share')));
 expect(writeText).toHaveBeenCalledWith(window.location.href);
 expect(view.container.querySelector('[data-mx-reader-toast]')).not.toHaveAttribute('hidden');
});
it('uses the shared reveal-on-upscroll policy, while edit mode pins chrome',()=>{
 vi.spyOn(document.documentElement,'scrollHeight','get').mockReturnValue(3000);
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(fn=>{fn(0);return 1;});
 const original=Object.getOwnPropertyDescriptor(window,'scrollY');
 const scroll=(y:number)=>act(()=>{Object.defineProperty(window,'scrollY',{value:y,configurable:true});window.dispatchEvent(new Event('scroll'));});
 const input={artifactId:'story1',title:'Title',author:null};
 const view=render(<InlineReaderChrome input={input} onAction={vi.fn()} />);
 const root=view.container.querySelector('[data-mx-reader-chrome]')!;
 try {
   scroll(200);expect(root).toHaveAttribute('data-mx-reader-state','hidden');
   scroll(100);expect(root).toHaveAttribute('data-mx-reader-state','shown');
   scroll(300);expect(root).toHaveAttribute('data-mx-reader-state','hidden');
   view.rerender(<InlineReaderChrome input={input} pinned onAction={vi.fn()} />);
   expect(view.container.querySelector('[data-mx-reader-chrome]')).toBe(root);
   scroll(500);expect(view.container.querySelector('[data-mx-reader-chrome]')).toHaveAttribute('data-mx-reader-state','shown');
 } finally {if(original)Object.defineProperty(window,'scrollY',original);}
});
it('uses the shared reader bar without obsolete standalone controls panels',()=>{
 const action=vi.fn();const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:{username:'author'}}} onAction={action} />);
 fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(action).toHaveBeenCalledWith('controls');
 expect(screen.queryByLabelText('Artifact controls')).toBeNull();
 expect(view.container.querySelector('[data-mx-reader-panel]')).toBeNull();
 expect(screen.getByLabelText("View @author's profile")).toHaveAttribute('target','_self');
});
it('shows controls immediately when navigating from a scrolled artifact to another',()=>{
 vi.spyOn(document.documentElement,'scrollHeight','get').mockReturnValue(3000);
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(fn=>{fn(0);return 1;});
 const original=Object.getOwnPropertyDescriptor(window,'scrollY');
 try {
   Object.defineProperty(window,'scrollY',{value:0,configurable:true});
   const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'One',author:null}} onAction={vi.fn()} />);
   expect(view.container.querySelector('[data-mx-reader-chrome]')).toHaveAttribute('data-mx-reader-state','shown');
   act(()=>{Object.defineProperty(window,'scrollY',{value:300,configurable:true});window.dispatchEvent(new Event('scroll'));});
   expect(view.container.querySelector('[data-mx-reader-chrome]')).toHaveAttribute('data-mx-reader-state','hidden');
   view.rerender(<InlineReaderChrome input={{artifactId:'story2',title:'Two',author:null}} onAction={vi.fn()} />);
   expect(view.container.querySelector('[data-mx-reader-chrome]')).toHaveAttribute('data-mx-reader-state','shown');
 } finally {if(original)Object.defineProperty(window,'scrollY',original);}
});

it('offers fork directly in the shared desktop and mobile rail', () => {
 const action=vi.fn();const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:null}} onAction={action} />);
 fireEvent.click(screen.getByLabelText('Fork artifact'));
 expect(action).toHaveBeenCalledWith('fork');
 expect(view.container.querySelector('.mx-reader-rail [data-mx-reader-action="fork"]')).not.toBeNull();
});
