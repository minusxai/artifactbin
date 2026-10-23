/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceShell from '../WorkspaceShell';
vi.mock('@solidjs/router',()=>({useLocation:()=>({pathname:'/',search:''})}));
vi.mock('../../lib/session',()=>({useSession:()=>({session:()=>({kind:'account',user:{id:'person',username:'person',email:'person@example.com'}})})}));
vi.mock('../../lib/notifications',()=>({useOptionalInbox:()=>({state:()=>({unread:3})})}));
afterEach(cleanup);
it('keeps workspace, profile and account navigation while retiring agent and schedule entry points',()=>{
 render(()=><WorkspaceShell canCreate={false}><p>Workspace content</p></WorkspaceShell>);
 const retained={Artifacts:'/',Groups:'/groups',Personal:'/?personal=1',Assets:'/assets',Trash:'/trash',Notifications:'/notifications','Human docs':'/docs-human','Public profile':'/@person','Account settings':'/account'};
 for(const [name,href] of Object.entries(retained))expect(screen.getByRole('link',{name})).toHaveAttribute('href',href);
 expect(screen.queryByRole('link',{name:'Connected Agents'})).toBeNull();
 expect(screen.queryByRole('link',{name:'Schedules'})).toBeNull();
 expect(screen.getByLabelText('3 unread notifications')).toBeInTheDocument();
 expect(screen.getByText('Workspace content')).toBeInTheDocument();
});
