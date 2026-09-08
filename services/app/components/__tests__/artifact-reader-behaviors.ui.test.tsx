import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('wires outline navigation and wide-table affordances in the actual direct document',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  const source='<article>'+['First','Second','Third','Fourth'].map(t=>`<section><h2>${t}</h2><p>Text</p></section>`).join('')+'<table><tbody><tr><td>Wide</td></tr></tbody></table></article>';
  const props:ArtifactSurfaceProps={id:'reader1',editId:'e1',format:'markup',title:'Reader',source,content:source,template:'editorial',refs:[],version:1,columns:[],compiledCss:null,theme:'modernist',colorMode:'light',liveEnabled:false};
  const view=render(<ArtifactSurface {...props}/>);
  await screen.findByText('Wide');
  const headings=view.container.querySelectorAll<HTMLElement>('.mx-doc h2');
  const scroll=vi.fn();headings[1].scrollIntoView=scroll;
  fireEvent.click(view.container.querySelectorAll('.mx-outline-row')[1]);
  expect(scroll).toHaveBeenCalledWith({behavior:'smooth',block:'start'});
  const table=view.container.querySelector('table')!;
  Object.defineProperties(table,{clientWidth:{value:100,configurable:true},scrollWidth:{value:400,configurable:true}});
  fireEvent(window,new Event('resize'));
  await waitFor(()=>expect(table).toHaveAttribute('data-mx-scrollable',''));
  view.unmount();
  scroll.mockClear();fireEvent.click(headings[1]);
  expect(scroll).not.toHaveBeenCalled();
});
