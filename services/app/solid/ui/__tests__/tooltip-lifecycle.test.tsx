/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
import {Tooltip} from '../Tooltip';
afterEach(async()=>{cleanup();await vi.dynamicImportSettled();});
it('keeps first keyboard focus described, cancels during chunk loading and never opens late',async()=>{
 render(()=><Tooltip content="Reader action"><button>Action</button></Tooltip>);
 const trigger=screen.getByRole('button',{name:'Action'});
 fireEvent.focus(trigger);
 const initial=screen.getByRole('tooltip');expect(initial).toHaveTextContent('Reader action');
 expect(trigger).toHaveAttribute('aria-describedby',initial.id);
 fireEvent.keyDown(document,{key:'Escape'});
 await vi.dynamicImportSettled();expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
 expect(trigger).not.toHaveAttribute('aria-describedby');
 fireEvent.blur(trigger);fireEvent.focus(trigger);
 const painted=await screen.findByRole('tooltip');
 await waitFor(()=>expect(painted.closest('[data-radix-popper-content-wrapper]')).not.toBeNull());
 expect(screen.getAllByRole('tooltip')).toHaveLength(1);
 expect(trigger).toHaveAttribute('aria-describedby',painted.id);
 fireEvent.blur(trigger);expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
it('does not leave a delayed tooltip or portal after a rapid pointer leave and reuses the loaded popup',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  const page=render(()=><Tooltip content="Reader action"><button>Action</button></Tooltip>);
  const trigger=screen.getByRole('button',{name:'Action'});
  fireEvent.pointerMove(trigger,{pointerType:'mouse'});fireEvent.pointerLeave(trigger);
  vi.advanceTimersByTime(400);await vi.dynamicImportSettled();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.focus(trigger);await vi.dynamicImportSettled();
  expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  page.unmount();vi.advanceTimersByTime(400);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
 }finally{vi.useRealTimers();}
});
