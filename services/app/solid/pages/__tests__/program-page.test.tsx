/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
import {ProgramPage} from '../Program';
vi.mock('@/solid/lib/session',()=>({useSession:()=>({session:()=>({user:{id:'alice'}})})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('creates a private saved program and invokes it',async()=>{
 const calls:Array<{url:string;body:any}>=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{const body=init?.body?JSON.parse(String(init.body)):null;calls.push({url,body});if(url==='/api/my/artifacts')return Response.json({id:'program-one',version:1,state:'state-one'});if(url.endsWith('/invoke'))return Response.json({runId:'run-one'});return Response.json({runId:'run-one',status:'completed',output:'hello'});}));
 render(()=><ProgramPage/>);fireEvent.input(screen.getByLabelText('Program title'),{target:{value:'Hello program'}});fireEvent.input(screen.getByLabelText('Program JSON'),{target:{value:JSON.stringify({version:1,command:['node','-e','console.log("hello")']})}});fireEvent.click(screen.getByRole('button',{name:'Save program'}));await screen.findByRole('link',{name:'Open saved program'});
 expect(calls.find(call=>call.url==='/api/my/artifacts')?.body).toMatchObject({title:'Hello program',program:{version:1,command:['node','-e','console.log("hello")']},visibility:'private'});
 fireEvent.click(screen.getByRole('button',{name:'Run program'}));await screen.findByText('completed');expect(screen.getByLabelText('Schedule program')).toHaveAttribute('href','/schedules?artifact=program-one');
});
it('hides execution controls from readers',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'program-one',title:'Shared program',program:{version:1,command:['echo','hello']},version:1,state:'state-one'})));
 render(()=><ProgramPage artifactId="program-one" owner={false}/>);await screen.findByDisplayValue('Shared program');expect(screen.queryByRole('button',{name:'Run program'})).toBeNull();expect(screen.queryByLabelText('Schedule program')).toBeNull();expect(screen.getByText('Only the owner can run or schedule this program.')).toBeInTheDocument();
});

it('uses the read version/state when replacing an existing program and reports invalid JSON',async()=>{
 const writes:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{if(init?.method==='PUT')writes.push(JSON.parse(String(init.body)));return Response.json({id:'program-one',title:'Current program',program:{version:1,command:['echo','hello']},version:3,state:'state-three'});}));
 render(()=><ProgramPage artifactId="program-one" owner/>);await screen.findByDisplayValue('Current program');fireEvent.input(screen.getByLabelText('Program JSON'),{target:{value:'{'}});fireEvent.click(screen.getByRole('button',{name:'Save program'}));expect(await screen.findByRole('alert')).toHaveTextContent('Program must be valid JSON.');expect(writes).toHaveLength(0);
 fireEvent.input(screen.getByLabelText('Program JSON'),{target:{value:JSON.stringify({version:1,command:['echo','changed']})}});fireEvent.click(screen.getByRole('button',{name:'Save program'}));await screen.findByText('Program saved.');expect(writes[0]).toMatchObject({expectedVersion:3,expectedState:'state-three',program:{command:['echo','changed']}});
});
it('retries an ambiguously accepted program invocation with the same request ID',async()=>{
 const ids:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  if(url.endsWith('/invoke')){ids.push(JSON.parse(String(init.body)).requestId);if(ids.length===1)throw Error('Response lost');return Response.json({runId:'run-one'});}
  if(url.startsWith('/api/runs/'))return Response.json({runId:'run-one',status:'completed',output:null});
  return Response.json({id:'program-one',title:'Saved',program:{version:1,command:['echo','hello']},version:1,state:'state-one'});
 }));render(()=><ProgramPage artifactId="program-one" owner/>);await screen.findByDisplayValue('Saved');fireEvent.click(screen.getByRole('button',{name:'Run program'}));await screen.findByText('Response lost');fireEvent.click(screen.getByRole('button',{name:'Run program'}));await screen.findByText('completed');expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0]);
});
it('loads the newly selected program when navigation reuses the editor',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json({id:url.split('/').pop(),title:'Program '+url.split('/').pop(),program:{version:1,command:['echo',url]},version:1,state:'state-one'})));
 const {createSignal}=await import('solid-js');const [id,setId]=createSignal('first');render(()=><ProgramPage artifactId={id()} owner/>);await screen.findByDisplayValue('Program first');setId('second');await screen.findByDisplayValue('Program second');
});
