import { render,screen,fireEvent,act } from '@testing-library/react';
import { expect,it,vi,afterEach } from 'vitest';
import { InlineReaderChrome } from '../InlineReaderChrome';
import MobileSheet from '../MobileSheet';
// What the page's drawer announces when it opens or shuts (PageChrome announcePanel).
const announce=(which:'menu'|'controls',open:boolean)=>window.dispatchEvent(new CustomEvent('mx:page-chrome-state',{detail:{which,open}}));
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

it("flips the menu trigger's name with the page's drawer, the reader's face drawn on it",()=>{
 const input={artifactId:'story1',title:'Title',author:{username:'author',id:'usr_author',image:null},viewer:{id:'usr_me',name:'me',image:'/api/users/usr_me/avatar?v=1'}};
 const view=render(<InlineReaderChrome input={input} onAction={vi.fn()} />);
 const trigger=()=>view.container.querySelector<HTMLElement>('[data-mx-reader-trigger="menu"]')!;
 expect(trigger().querySelector('.mx-reader-face img')).toHaveAttribute('src','/api/users/usr_me/avatar?v=1');
 expect(screen.getByLabelText('Open menu')).toBe(trigger());
 act(()=>announce('menu',true));
 expect(trigger()).toHaveAttribute('aria-expanded','true');
 expect(screen.getByLabelText('Close menu')).toBe(trigger());
 // A re-render (a count, a title) keeps what the drawer says.
 view.rerender(<InlineReaderChrome input={{...input,title:'Renamed'}} onAction={vi.fn()} />);
 expect(trigger()).toHaveAttribute('aria-expanded','true');
 expect(trigger()).toHaveAttribute('aria-label','Close menu');
 act(()=>announce('menu',false));
 expect(trigger()).toHaveAttribute('aria-expanded','false');
 expect(screen.getByLabelText('Open menu')).toBe(trigger());
});

it('shows the initial when a face fails to load',()=>{
 const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:null,viewer:{id:'usr_me',name:'me',image:'/gone.png'}}} onAction={vi.fn()} />);
 const face=view.container.querySelector<HTMLElement>('[data-mx-reader-trigger="menu"] .mx-reader-face')!;
 act(()=>{face.querySelector('img')!.dispatchEvent(new Event('error'));});
 expect(face.querySelector('img')).toBeNull();
 expect(face.querySelector('.mx-reader-face-initial')).toHaveTextContent('M');
});

it('steps aside while a sheet is open, even pinned, and returns when it closes', () => {
 const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:null}} pinned onAction={vi.fn()} />);
 const root=view.container.querySelector('[data-mx-reader-chrome]')!;
 expect(root).not.toHaveClass('mx-reader-chrome--covered');
 const sheet=render(<MobileSheet label="Comments" onClose={vi.fn()} size="half">c</MobileSheet>);
 expect(root).toHaveClass('mx-reader-chrome--covered');
 sheet.unmount();
 expect(root).not.toHaveClass('mx-reader-chrome--covered');
});

it('steps aside while the page opens the profile menu or settings from the rail', () => {
 const view=render(<InlineReaderChrome input={{artifactId:'story1',title:'Title',author:null}} onAction={vi.fn()} />);
 const root=view.container.querySelector('[data-mx-reader-chrome]')!;
 act(()=>announce('menu',true));
 expect(root).toHaveClass('mx-reader-chrome--covered');
 expect(screen.getByLabelText('Close menu')).toHaveAttribute('aria-expanded','true');
 act(()=>announce('menu',false));
 expect(root).not.toHaveClass('mx-reader-chrome--covered');
});
