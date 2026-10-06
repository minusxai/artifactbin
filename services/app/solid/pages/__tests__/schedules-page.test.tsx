/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
import {SchedulesPage,SchedulesRoute} from '../Schedules';
import {createMemoryHistory,MemoryRouter,Route} from '@solidjs/router';
vi.mock('@/solid/lib/session',()=>({useSession:()=>({session:()=>({user:{id:'alice'}})})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'', '/');});
it('prefills from the active router query before browser history catches up',async()=>{
 const history=createMemoryHistory();history.set({value:'/schedules?artifact=program-one',scroll:false,replace:true});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({schedules:[]})));
 render(()=><MemoryRouter history={history}><Route path="/schedules" component={SchedulesRoute}/></MemoryRouter>);
 await screen.findByText('No schedules yet.');
 expect(screen.getByLabelText('Artifact ID')).toHaveValue('program-one');
});
it('creates, edits, pauses and manually runs a schedule, showing actual attempt errors',async()=>{
 let rows:any[]=[];const calls:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  const method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):null;calls.push({url,method,body});
  if(url.endsWith('/history'))return Response.json({history:[{id:'occ',scheduledFor:'2026-10-05T01:00:00Z',status:'failed',attempts:[{id:'attempt',attemptNumber:1,status:'failed',runId:'run-one',error:'Image pull failed'}]}]});
  if(url.endsWith('/run'))return Response.json({occurrenceId:'occ'});
  if(method==='POST'){rows=[{...body,id:'schedule-one',enabled:true,nextDueAt:'2026-10-06T00:00:00Z'}];return Response.json(rows[0]);}
  if(method==='DELETE'){rows=[];return Response.json({ok:true});}
  if(method==='PATCH'){rows[0]={...rows[0],...body};return Response.json(rows[0]);}
  return Response.json({schedules:rows});
 }));
 render(()=><SchedulesPage artifactId="doc-one"/>);
 await screen.findByText('No schedules yet.');
 fireEvent.input(screen.getByLabelText('Cron expression'),{target:{value:'*/5 * * * *'}});
 fireEvent.click(screen.getByRole('button',{name:'Create schedule'}));
 await screen.findByText('*/5 * * * *');
 expect(calls.find(call=>call.method==='POST').body).toMatchObject({artifactId:'doc-one',timezone:'UTC',maxAttempts:1,retryBackoffSeconds:60,input:null});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Edit doc-one'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Edit doc-one'}));
 fireEvent.input(screen.getByLabelText('Cron expression'),{target:{value:'0 * * * *'}});fireEvent.click(screen.getByRole('button',{name:'Save schedule'}));await screen.findByText('0 * * * *');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Pause doc-one'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Pause doc-one'}));await screen.findByRole('button',{name:'Resume doc-one'});expect(screen.getByRole('button',{name:'Run now doc-one'})).toBeDisabled();expect(screen.getByText('Resume to run.')).toBeInTheDocument();await waitFor(()=>expect(screen.getByRole('button',{name:'Resume doc-one'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Resume doc-one'}));await screen.findByRole('button',{name:'Pause doc-one'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Run now doc-one'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Run now doc-one'}));await screen.findByText('Image pull failed');expect(screen.getByText(/run-one/)).toBeInTheDocument();
 expect(calls.find(call=>String(call.url).endsWith('/run')).body.requestId).toBeTruthy();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Delete doc-one'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Delete doc-one'}));fireEvent.click(screen.getByRole('button',{name:'Confirm delete'}));await screen.findByText('No schedules yet.');
});
it('preserves the draft and explains server rejection',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>init?.method==='POST'?Response.json({error:'Invalid cron expression'},{status:400}):Response.json({schedules:[]})));
 render(()=><SchedulesPage artifactId="doc-one"/>);await screen.findByText('No schedules yet.');fireEvent.click(screen.getByRole('button',{name:'Create schedule'}));expect(await screen.findByRole('alert')).toHaveTextContent('Invalid cron expression');expect(screen.getByLabelText('Artifact ID')).toHaveValue('doc-one');
});

it('retries an ambiguously accepted manual run with the same ID and refreshes history',async()=>{
 const record={id:'schedule-one',artifactId:'doc-one',cron:'0 * * * *',timezone:'UTC',input:null,enabled:true,nextDueAt:'2026-10-06T00:00:00Z',maxAttempts:1,retryBackoffSeconds:60};
 const ids:string[]=[];let historyReads=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  if(url.endsWith('/run')){ids.push(JSON.parse(String(init.body)).requestId);if(ids.length===1)throw Error('Response lost');return Response.json({occurrenceId:'occ'});}
  if(url.endsWith('/history')){historyReads++;return Response.json({history:[{id:'occ',scheduledFor:'2026-10-05T01:00:00Z',status:historyReads===1?'active':'completed',attempts:[]}]});}
  return Response.json({schedules:[record]});
 }));render(()=><SchedulesPage/>);await screen.findByRole('button',{name:'Run now doc-one'});fireEvent.click(screen.getByRole('button',{name:'Run now doc-one'}));await screen.findByText('Response lost');await waitFor(()=>expect(screen.getByRole('button',{name:'Run now doc-one'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Run now doc-one'}));await screen.findByRole('button',{name:'Refresh history'});expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0]);await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh history'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Refresh history'}));await screen.findByText(/ · completed/);expect(historyReads).toBe(2);
});

it('prefills the artifact query when route props contain an empty artifact ID',async()=>{
 window.history.replaceState({},'', '/schedules?artifact=program-one');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({schedules:[]})));
 render(()=><SchedulesPage artifactId=""/>);await screen.findByText('No schedules yet.');expect(screen.getByLabelText('Artifact ID')).toHaveValue('program-one');
});


it('explains the actual invalid_schedule code while preserving the complete draft',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>init?.method==='POST'?Response.json({error:'invalid_schedule'},{status:400}):Response.json({schedules:[]})));
 render(()=><SchedulesPage artifactId="doc-one"/>);await screen.findByText('No schedules yet.');
 fireEvent.input(screen.getByLabelText('Cron expression'),{target:{value:'not a cron'}});
 fireEvent.input(screen.getByLabelText('Timezone'),{target:{value:'Bad/Zone'}});
 fireEvent.click(screen.getByRole('button',{name:'Create schedule'}));
 const alert=await screen.findByRole('alert');expect(alert).toHaveTextContent(/five.*fields/i);expect(alert).toHaveTextContent(/timezone/i);expect(alert).toHaveTextContent(/1.?10 attempts/i);expect(alert).toHaveTextContent(/1.?86,400 seconds/i);expect(alert).not.toHaveTextContent('invalid_schedule');
 expect(screen.getByLabelText('Cron expression')).toHaveValue('not a cron');expect(screen.getByLabelText('Timezone')).toHaveValue('Bad/Zone');expect(screen.getByLabelText('Artifact ID')).toHaveValue('doc-one');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Create schedule'})).toBeEnabled());
});
