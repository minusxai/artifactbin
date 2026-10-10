/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupManagement } from '../Group';
const detail = {group:{id:'g1',handle:'team',name:'Team',description:'',role:'editor' as const},members:[{user_id:'u1',username:'alice',name:'Alice',role:'editor' as const}],linked_groups:[],invitations:[]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('viewer can search people and open profiles without management controls',()=>{
 render(()=> <GroupManagement detail={{...detail,group:{...detail.group,role:'viewer'}}} refresh={()=>{}} />);
 expect(screen.getByRole('link',{name:'Alice'})).toHaveAttribute('href','/@alice');
 fireEvent.input(screen.getByRole('searchbox',{name:'Search people'}),{target:{value:'missing'}});
 expect(screen.queryByRole('link',{name:'Alice'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Invite person'})).not.toBeInTheDocument();
});
it('keeps last-editor refusal visible and preserves member role',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'last_editor'},{status:409})));
 render(()=> <GroupManagement detail={detail} refresh={()=>{}} />);
 fireEvent.change(screen.getByRole('combobox',{name:'Role for Alice'}),{target:{value:'viewer'}});
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Keep at least one editor'));
 expect(screen.getByRole('combobox',{name:'Role for Alice'})).toHaveValue('editor');
});
