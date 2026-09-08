import { render,screen,fireEvent,act } from '@testing-library/react';
import { expect,it,vi,afterEach } from 'vitest';
import { InlineReaderChrome } from '../InlineReaderChrome';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shows copied-link feedback after clipboard sharing',async()=>{
 const writeText=vi.fn(async()=>{});vi.stubGlobal('navigator',{clipboard:{writeText}});
 const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:null}} onAction={vi.fn()} />);
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
