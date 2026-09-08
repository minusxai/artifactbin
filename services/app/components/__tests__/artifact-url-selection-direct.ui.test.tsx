import {render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';

afterEach(()=>vi.unstubAllGlobals());
it('seeds the first direct render from typed URL scalars before the runtime starts',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'URL selection',source:'<p aria-label="Chosen region">{$region}</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false,search:'?$region=west',
    dataflow:{flow:{values:[{kind:'scalar',name:'region',type:'string',default:'north',start:0,end:0}],queries:[]}}};
  render(<ArtifactSurface {...props}/>);
  await waitFor(()=>expect(screen.getByLabelText('Chosen region')).toHaveTextContent('west'));
});
