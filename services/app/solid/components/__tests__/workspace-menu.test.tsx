/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MenuPanel } from '../PageChromePanels';
vi.mock('@solidjs/router',()=>({useLocation:()=>({pathname:'/',search:''})}));
vi.mock('../../lib/session',()=>({useSession:()=>({session:()=>({kind:'account',user:{id:'person'}})})}));
afterEach(cleanup);
it('keeps the logo and account menu without links to retired pages',()=>{
 render(()=><MenuPanel close={()=>{}}/>);
 for(const name of ['Artifacts','Notifications','Account','Human Docs','Hosted at artifactbin'])expect(screen.getByRole('link',{name})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Sign out'})).toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Schedules'})).toBeNull();
 expect(screen.queryByRole('link',{name:'Connected Agents'})).toBeNull();
});
