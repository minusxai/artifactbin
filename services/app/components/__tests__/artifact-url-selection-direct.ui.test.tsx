import {render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
import {storyBodyFor} from '@/lib/story/body';

afterEach(()=>vi.unstubAllGlobals());
it('seeds the first direct render from typed URL scalars before the runtime starts',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'URL selection',source:'<p aria-label="Chosen region">{$region}</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false,search:'?$region=west',
    dataflow:{flow:{values:[{kind:'scalar',name:'region',type:'string',default:'north',start:0,end:0}],queries:[]}}};
  render(<ArtifactSurface {...props}/>);
  await waitFor(()=>expect(screen.getByLabelText('Chosen region')).toHaveTextContent('west'));
});

it('seeds a prepared surface and does not reset the choice on source adoption',async()=>{
  const source='<Helmet><Value name="region" type="string" default="north" /><Query name="sales">{`select $region region`}</Query></Helmet><p aria-label="Prepared region">{$region}</p>';
  const split=storyBodyFor(source)!;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({tables:{sales:{columns:[{name:'region',type:'string'}],rows:[{region:'west'}]}},errors:{}})));
  const dataflow={flow:{values:split.content.values,queries:split.content.queries}};
  const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'Prepared URL selection',source,content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false,search:'?$region=west',dataflow,
    preparedStory:{nodes:split.body,refData:{},colorMode:'light',template:null,chrome:true,dataflow}};
  const view=render(<ArtifactSurface {...props}/>);
  await waitFor(()=>expect(screen.getByLabelText('Prepared region')).toHaveTextContent('west'));
  const next=storyBodyFor(source+'<span>updated</span>')!;
  view.rerender(<ArtifactSurface {...props} preparedStory={{...props.preparedStory!,nodes:next.body,dataflow:{flow:{values:next.content.values,queries:next.content.queries}}}}/>);
  await waitFor(()=>expect(screen.getByLabelText('Prepared region')).toHaveTextContent('west'));
});
