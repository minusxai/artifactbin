import {render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {expect,it,vi} from 'vitest';
import {PublicPage} from '@/web/PublicPage';

it('keeps public footer creation as navigation to the trusted start slot, never a parent mutation',()=>{
  const request=vi.fn();vi.stubGlobal('fetch',request);
  render(<MemoryRouter><PublicPage data={{path:'/',controls:'https://i.example.test'}}/></MemoryRouter>);
  const start=screen.getByLabelText('Go to create a live document');
  expect(start).toHaveAttribute('href','#get-started');
  fireEvent.click(start);expect(request).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
