import {render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router';
import {expect,it,vi} from 'vitest';
vi.mock('../session',()=>({useSession:()=>({session:{kind:'account',user:{id:'user'}}})}));
import {LoginPage} from '../pages/Login';
it('returns an existing account session without asking for another OTP',async()=>{
  render(<MemoryRouter initialEntries={['/login?callbackUrl=%2Faccount']}><Routes><Route path="/login" element={<LoginPage/>}/><Route path="/account" element={<div aria-label="Account destination"/>}/></Routes></MemoryRouter>);
  await waitFor(()=>expect(screen.queryByLabelText('Account destination')).not.toBeNull());
  expect(screen.queryByLabelText('Email')).toBeNull();
});
