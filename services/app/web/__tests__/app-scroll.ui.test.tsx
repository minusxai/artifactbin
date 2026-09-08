import {act,cleanup,fireEvent,render} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,useNavigate} from 'react-router';
import {AppNavigationBinding} from '../AppNavigation';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('resets push navigation and restores the prior history entry on back',async()=>{
 let go:ReturnType<typeof useNavigate>;let y=900;
 vi.spyOn(window,'scrollY','get').mockImplementation(()=>y);
 const scroll=vi.spyOn(window,'scrollTo').mockImplementation((_x,top)=>{y=Number(top);});
 function Driver(){go=useNavigate();return <AppNavigationBinding/>;}
 render(<MemoryRouter initialEntries={['/privacy']}><Driver/></MemoryRouter>);
 fireEvent.scroll(window);await act(async()=>{await go!('/terms');});expect(scroll).toHaveBeenLastCalledWith(0,0);
 await act(async()=>{await go!(-1);});expect(scroll).toHaveBeenLastCalledWith(0,900);
});
it('waits for a delayed fragment target and cancels pending restoration on a reader gesture',async()=>{
 let go:ReturnType<typeof useNavigate>;const into=vi.fn();
 function Driver(){go=useNavigate();return <AppNavigationBinding/>;}
 render(<MemoryRouter initialEntries={['/privacy']}><Driver/></MemoryRouter>);
 await act(async()=>{await go!('/terms#late');});
 const target=document.createElement('div');target.id='late';target.scrollIntoView=into;
 await act(async()=>{document.body.append(target);});expect(into).toHaveBeenCalled();target.remove();
 await act(async()=>{await go!('/terms#cancelled');});fireEvent.wheel(window);
 const cancelled=document.createElement('div');cancelled.id='cancelled';cancelled.scrollIntoView=into;into.mockClear();
 await act(async()=>{document.body.append(cancelled);});expect(into).not.toHaveBeenCalled();cancelled.remove();
});

it('retries a clamped POP position when asynchronous route content arrives',async()=>{
 let go:ReturnType<typeof useNavigate>;let y=900,canScroll=true;
 vi.spyOn(window,'scrollY','get').mockImplementation(()=>y);
 vi.spyOn(window,'scrollTo').mockImplementation((_x,top)=>{y=canScroll?Number(top):0;});
 function Driver(){go=useNavigate();return <AppNavigationBinding/>;}
 render(<MemoryRouter initialEntries={['/privacy']}><Driver/></MemoryRouter>);fireEvent.scroll(window);
 await act(async()=>{await go!('/terms');});canScroll=false;await act(async()=>{await go!(-1);});expect(y).toBe(0);
 const loaded=document.createElement('div');canScroll=true;await act(async()=>{document.body.append(loaded);});expect(y).toBe(900);loaded.remove();
});
