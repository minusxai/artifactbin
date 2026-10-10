/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
import {AgentLink} from '../AgentLink';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('sends an explicit Personal starter destination instead of applying a saved group default',()=>{
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(()=>{})));
 render(()=> <AgentLink destination={{type:'personal'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create a live document for my agent'}));
 expect(fetch).toHaveBeenCalledWith('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destination:{type:'personal'}})});
});
it('preserves the ordinary bodyless starter request when no destination is supplied',()=>{
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(()=>{})));
 render(()=> <AgentLink/>);
 fireEvent.click(screen.getByRole('button',{name:'Create a live document for my agent'}));
 expect(fetch).toHaveBeenCalledWith('/api/start',{method:'POST'});
});
