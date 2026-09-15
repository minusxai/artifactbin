import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import AdminDocuments from '../AdminDocuments';
afterEach(()=>vi.unstubAllGlobals());
it('requires explicit mode, displays source as text, and retains a conflicted repair',async()=>{
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(new Headers(init?.headers).get('X-Artifactbin-Admin')).toBe('1');
  if(init?.method==='PUT')return Response.json({error:'version_conflict'},{status:409});
  if(String(input).includes('/abc123'))return Response.json({id:'abc123',title:'Private widget',version:1,edit_id:'base',source:'<script>alert(1)</script>'});
  return Response.json({documents:[{id:'abc123',title:'Private widget',version:1}],next:null});
 });vi.stubGlobal('fetch',fetcher);
 const view=render(<AdminDocuments />);expect(fetcher).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Enter admin mode'}));
 fireEvent.click(await screen.findByRole('button',{name:'Inspect Private widget'}));
 const source=await screen.findByRole('textbox',{name:'Document source'});expect(source).toHaveValue('<script>alert(1)</script>');expect(view.container.querySelector('script')).toBeNull();
 fireEvent.change(source,{target:{value:'<p>Fixed</p>'}});fireEvent.change(screen.getByRole('textbox',{name:'Repair reason'}),{target:{value:'Repair widget'}});
 fireEvent.click(screen.getByRole('button',{name:'Publish repair'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('version_conflict'));
 expect(source).toHaveValue('<p>Fixed</p>');
});
