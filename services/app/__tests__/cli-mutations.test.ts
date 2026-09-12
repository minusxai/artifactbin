/**
 * The REAL CLI through the REAL data handlers: SQL reads and writes, declared mutations, dataset
 * definitions, governance policy, and the durable recovery that makes a lost reply finishable.
 */

import { expect, it, vi } from 'vitest';
import { services, setServices } from '@/lib/services';
import { getDb } from '@/lib/db';
import { request, useAppHarness } from './harness';
import { cliWorkspace } from './cli-harness';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as mutate } from '@/app/api/artifacts/[id]/mutate/route';
import { GET as read, PUT as replace, PATCH as metadata, PATCH as patch } from '@/app/api/artifacts/[id]/route';
import { mintToken } from '@/lib/tokens';
import { GET as versions } from '@/app/api/artifacts/[id]/versions/route';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { getArtifactById } from '@/lib/artifacts';
import { POST as queryRead } from '@/app/api/artifacts/[id]/query/route';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';
import { readRecord } from '../../cli/test/tracking';
import { parseResourceFile, writeResourceFile } from '../../cli/src/resource-file';
import { POST as preflight } from '@/app/api/artifacts/preflight/route';
import { POST as secrets } from '@/app/api/my/secrets/route';
import { resolveDatasetConnection } from '@/lib/datasets/secrets';
import { DatasetError } from '@/lib/datasets/errors';

useAppHarness();

describe('cli-mutation-recovery', () => {
  it('retrying one mutation identity returns its durable response without applying the SQL twice',async()=>{
   const token=await mintToken('mxmx_test_mutation_recovery');
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));expect(initial.status).toBe(201);const doc=await initial.json();
   const params={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}/mutate`;
   const send=async(sql='insert into public.rows (n) values (2)')=>{
    const req=request(path,{method:'POST',token:token.token,json:{sql}});req.headers.set('Idempotency-Key','mxmx_test_mutation_once');return mutate(req,params);
   };
   const first=await send();expect(first.status).toBe(200);const receipt=await first.json();
   const replay=await send();expect(replay.status).toBe(200);expect(await replay.json()).toEqual(receipt);
   const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),params);expect((await state.json()).rows).toEqual([{n:1},{n:2}]);
   expect((await send('insert into public.rows (n) values (3)')).status).toBe(409);
  });

  it('concurrent and interrupted retries cannot spend a second generation call',async()=>{
   const original=services();let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;});
   const generate=vi.fn(async()=>{began();await waiting;return {json:'{"ok":true}',usage:{input:1,output:1}};});
   setServices({generation:{generate}});
   try{
    const token=await mintToken('mxmx_test_generation_receipt');
    const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{result:'seed'}],access:'readwrite'}}));expect(initial.status).toBe(201);const doc=await initial.json();
    const params={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}/mutate`;
    const config=JSON.stringify({model:'default',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}});
    const send=()=>{const req=request(path,{method:'POST',token:token.token,json:{sql:`insert into public.rows select llm('hello','answer','${config}')`}});req.headers.set('Idempotency-Key','mxmx_test_generation_once');return mutate(req,params);};
    const first=send();await started;
    const busy=await send();expect(busy.status).toBe(409);expect((await busy.json()).error).toBe('operation_pending');expect(generate).toHaveBeenCalledTimes(1);
    release();const completed=await first;expect(completed.status).toBe(200);const receipt=await completed.json();
    expect(await (await send()).json()).toEqual(receipt);expect(generate).toHaveBeenCalledTimes(1);
   }finally{release();setServices(original);}
  });

  it('receipt storage and the dataset pointer commit atomically; a failed commit never re-executes the claimed operation',async()=>{
   const token=await mintToken('mxmx_test_atomic_receipt');const db=await getDb();
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));const doc=await initial.json();
   await db.query('ALTER TABLE mutation_receipts ADD CONSTRAINT mxmx_test_refuse_receipt CHECK (response IS NULL)');
   const params={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}/mutate`;
   const send=()=>{const req=request(path,{method:'POST',token:token.token,json:{sql:'insert into public.rows (n) values (2)'}});req.headers.set('Idempotency-Key','mxmx_test_atomic_receipt');return mutate(req,params);};
   try{await send();}catch{/* The injected database failure may propagate through the direct handler. */}
   const current=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),params);expect((await current.json()).rows).toEqual([{n:1}]);
   await db.query('ALTER TABLE mutation_receipts DROP CONSTRAINT mxmx_test_refuse_receipt');
   const retry=await send();expect(retry.status).toBe(409);expect((await retry.json()).error).toBe('operation_pending');
  });

  it('observed-state mutations reject a stale head before executing SQL',async()=>{
   const token=await mintToken('mxmx_test_observed_mutation');
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));const doc=await initial.json();
   const req=request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,json:{sql:'insert into public.rows (n) values (2)',expectedState:'0'.repeat(64)}});req.headers.set('Idempotency-Key','mxmx_test_stale_mutation');
   const result=await mutate(req,{params:Promise.resolve({id:doc.id})});expect(result.status).toBe(409);expect((await result.json()).error).toBe('row_changed');
   const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),{params:Promise.resolve({id:doc.id})});expect((await state.json()).rows).toEqual([{n:1}]);
  });

  it('a governance change during generation prevents the observed-state write from committing',async()=>{
   const original=services(),db=await getDb();const token=await mintToken('mxmx_test_generation_race');
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{result:'seed'}],access:'readwrite'}}));const doc=await initial.json();
   const generate=vi.fn(async()=>{await db.query('UPDATE artifacts SET sharing_revision=sharing_revision+1 WHERE id=$1',[doc.id]);return {json:'{"ok":true}',usage:{input:1,output:1}};});setServices({generation:{generate}});
   try{
    const config=JSON.stringify({model:'default',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}});
    const req=request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,json:{sql:`insert into public.rows select llm('hello','answer','${config}')`,expectedState:doc.state}});req.headers.set('Idempotency-Key','mxmx_test_generation_race');
    const result=await mutate(req,{params:Promise.resolve({id:doc.id})});expect(result.status).toBe(409);expect((await result.json()).error).toBe('row_changed');expect(generate).toHaveBeenCalledTimes(1);
    const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),{params:Promise.resolve({id:doc.id})});expect((await state.json()).rows).toEqual([{result:'seed'}]);
   }finally{setServices(original);}
  });
});

describe('cli-declared-mutations', () => {
  const ctx=(id:string)=>({params:Promise.resolve({id})});
  it('exposes declared mutations on the artifact wire and runs one by name durably',async()=>{
   const owner=await mintToken('mxmx_test_declared');
   const publish=async(body:object)=>{const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));expect(r.status,await r.clone().text()).toBe(201);return (await r.json()).id as string;};
   const ds=await publish({dataset:[{n:1}],access:'readwrite'});
   const doc=await publish({markup:`<Helmet><Value name="n" type="number" default={5} /><Query name="rows" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values ($n)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
   const head=await read(request(`/api/artifacts/${doc}`,{token:owner.token}),ctx(doc));expect(head.status).toBe(200);
   expect((await head.json()).mutations).toEqual([{name:'add',params:[{name:'n'}]}]);
   const key='declared-mutation-key-0001';
   const run=()=>mutate(request(`/api/artifacts/${doc}/mutate`,{method:'POST',token:owner.token,json:{name:'add',values:{n:7}},headers:{'Idempotency-Key':key}}),ctx(doc));
   const first=await run();expect(first.status,await first.clone().text()).toBe(200);const body=await first.json();expect(body.affected).toBe(1);
   const replay=await run();expect(replay.status).toBe(200);expect(await replay.json()).toEqual(body);
   const rows=await loadDatasetRows((await getArtifactById(ds))!);expect(rows.map(r=>r.n).sort()).toEqual([1,7]);
   const unknown=await mutate(request(`/api/artifacts/${doc}/mutate`,{method:'POST',token:owner.token,json:{name:'nope'}}),ctx(doc));expect(unknown.status).toBe(400);expect((await unknown.json()).error).toBe('unknown_mutation');
   const outsider=await mintToken('mxmx_test_declared_outsider');
   const denied=await mutate(request(`/api/artifacts/${doc}/mutate`,{method:'POST',token:outsider.token,json:{name:'add'}}),ctx(doc));expect([403,404]).toContain(denied.status);
  });
  it('filters version history by author and time interval',async()=>{
   const owner=await mintToken('mxmx_test_history');
   const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>v1</p>'}}));expect(r.status).toBe(201);const id=(await r.json()).id as string;
   const all=await versions(request(`/api/artifacts/${id}/versions`,{token:owner.token}),ctx(id));expect(all.status).toBe(200);expect((await all.json()).versions.length).toBeGreaterThanOrEqual(1);
   const nobody=await versions(request(`/api/artifacts/${id}/versions?author=mxmx_nobody`,{token:owner.token}),ctx(id));expect((await nobody.json()).versions).toHaveLength(0);
   const future=await versions(request(`/api/artifacts/${id}/versions?since=2099-01-01T00:00:00Z`,{token:owner.token}),ctx(id));expect((await future.json()).versions).toHaveLength(0);
   const bad=await versions(request(`/api/artifacts/${id}/versions?since=yesterday`,{token:owner.token}),ctx(id));expect(bad.status).toBe(400);
  });
});

describe('cli-query-integration', () => {
  it('the real CLI recovers a committed dataset mutation after its response is lost',async()=>{
   const cli=await cliWorkspace('cli-query-handlers');const root=cli.root;
   try{
    const token=await mintToken('mxmx_test_cli_query_handler');
    const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));expect(initial.status).toBe(201);const doc=await initial.json();const context={params:Promise.resolve({id:doc.id})};
    await cli.useToken(token.token);await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');
    let lose=true;const keys:string[]=[];
    const transport:typeof fetch=async(input,init)=>{
     const req=new Request(input,init);
     if(new URL(req.url).pathname.endsWith('/mutate')){keys.push(req.headers.get('Idempotency-Key')!);const response=await mutate(req,context);if(lose){lose=false;throw Error('simulated lost response after commit');}return response;}
     return read(req,context);
    };
    const invoke=()=>cli.run(['query',doc.id,'--write','--input','change.sql'],transport);
    expect((await invoke()).result.error.code).toBe('outcome_unknown');
    const recovered=await invoke();expect(recovered.code,JSON.stringify(recovered)).toBe(0);expect(recovered.result.affected).toBe(1);expect(keys).toEqual([keys[0],keys[0]]);
    const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),context);expect((await state.json()).rows).toEqual([{n:1},{n:2}]);
   }finally{await cli.cleanup();}
  });

  it('native YAML dataset publication enables a subsequent real SQL write and preserves one local resource identity',async()=>{
   const cli=await cliWorkspace('cli-resource-handlers');const root=cli.root;
   try{
    const token=await mintToken('mxmx_test_cli_resource_handler');await cli.useToken(token.token);
    await writeFile(join(root,'sales.csv'),'n\n1\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\naccess: readwrite\n');
    let losePolicy=false;
    const transport:typeof fetch=async(input,init)=>{
     const req=new Request(input,init),path=new URL(req.url).pathname;
     if(path==='/api/artifacts')return create(req);
     const id=path.split('/')[3],context={params:Promise.resolve({id})};
     if(path.endsWith('/mutate'))return mutate(req,context);
     if(path.endsWith('/content'))return content(req,context);
     if(req.method==='PATCH'){const response=await metadata(req,context);if(losePolicy){losePolicy=false;throw new Error('lost policy reply after commit');}return response;}
     return req.method==='PUT'?replace(req,context):read(req,context);
    };
    const invoke=(args:string[])=>cli.run(args,transport);
    const published=await invoke(['push','sales.yaml']);expect(published.code,JSON.stringify(published)).toBe(0);
    const file=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));expect(file.type).toBe('dataset');expect(file.id).toBeTruthy();
    await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');
    const changed=await invoke(['query','sales.yaml','--write','--input','change.sql']);expect(changed.code,JSON.stringify(changed)).toBe(0);expect(changed.result.affected).toBe(1);
    const snapshot=await read(request(`/api/artifacts/${file.id}`,{token:token.token}),{params:Promise.resolve({id:file.id!})});expect((await snapshot.json()).rows).toEqual([{n:1},{n:2}]);
    const pulled=await invoke(['pull','sales.yaml']);expect(pulled.code,JSON.stringify(pulled)).toBe(0);expect(await readFile(join(root,'sales.csv'),'utf8')).toBe('n\n1\n2\n');
    const settings=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));if(settings.type!=='dataset')throw new Error('dataset expected');
    settings.policy={version:1,enforcement:'enabled',tables:[]};settings.title='Governed';await writeFile(join(root,'sales.yaml'),writeResourceFile(settings));
    losePolicy=true;expect((await invoke(['push','sales.yaml'])).result.error.code).toBe('outcome_unknown');
    const governed=await invoke(['push','sales.yaml']);expect(governed.code,JSON.stringify(governed)).toBe(0);
    const governedFile=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));expect(governedFile.title).toBe('Governed');if(governedFile.type==='dataset')expect(governedFile.policy_revision).toBe(1);
   }finally{await cli.cleanup();}
  });

  it('native remote reads share dataset SQL, paginate, reject stale cursors and enforce read access',async()=>{
   const cli=await cliWorkspace('cli-remote-read');const root=cli.root;
   try{
    const token=await mintToken('mxmx_test_cli_remote_read');await cli.useToken(token.token);
    const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1},{n:2},{n:3}],access:'readwrite'}}));expect(made.status).toBe(201);const doc=await made.json();
    await writeFile(join(root,'read.sql'),'select * from public.rows where n >= $minimum order by n');
    const invoke=(extra:string[]=[])=>cli.run(['query',doc.id,'--input','read.sql','--param','minimum=2','--limit','1',...extra],async(input,init)=>queryRead(new Request(input,init),{params:Promise.resolve({id:doc.id})}));
    const first=await invoke();expect(first.code,JSON.stringify(first)).toBe(0);expect(first.result.results[0].rows).toEqual([{n:2}]);const cursor=first.result.results[0].next_cursor;expect(cursor).toBeTruthy();
    const second=await invoke(['--cursor',cursor]);expect(second.result.results[0].rows).toEqual([{n:3}]);expect(second.result.results[0].next_cursor).toBeNull();
    const changed=await mutate(request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,json:{sql:'insert into public.rows (n) values (4)'}}),{params:Promise.resolve({id:doc.id})});expect(changed.status).toBe(200);
    expect((await invoke(['--cursor',cursor])).result.error.code).toBe('invalid_cursor');
   }finally{await cli.cleanup();}
  });

  it('a dry-run write validates against the real head and leaves every row where it was',async()=>{
   const cli=await cliWorkspace('cli-dry-write');const root=cli.root;
   try{
    const token=await mintToken('mxmx_test_cli_dry_write');await cli.useToken(token.token);
    const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));const doc=await made.json();
    const context={params:Promise.resolve({id:doc.id})};const calls:string[]=[];
    await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');
    const transport:typeof fetch=async(input,init)=>{
     const req=new Request(input,init);calls.push(`${req.method} ${new URL(req.url).pathname}`);
     return new URL(req.url).pathname.endsWith('/mutate')?mutate(req,context):read(req,context);
    };
    const result=await cli.invoke(['query',doc.id,'--write','--input','change.sql','--dry-run'],transport);
    expect(result.dry_run).toBe(true);expect(result.mutation).toBe('sql');expect(result.applied).toBe(false);
    expect(calls.every(call=>call.startsWith('GET '))).toBe(true);
    const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),context);expect((await state.json()).rows).toEqual([{n:1}]);
    expect(await readRecord(root,root,'pending-operation','current')).toBeNull();
   }finally{await cli.cleanup();}
  });

  it('a mixed batch read runs each target on its own engine and reports failures per target',async()=>{
   const cli=await cliWorkspace('cli-mixed-read');const root=cli.root;
   try{
    const token=await mintToken('mxmx_test_cli_mixed_read');await cli.useToken(token.token);
    const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:7}]}}));const doc=await made.json();
    await writeFile(join(root,'sales.csv'),'n\n1\n2\n');
    const invoke=(args:string[])=>cli.run(args,async(input,init)=>{
     const req=new Request(input,init);const id=new URL(req.url).pathname.split('/')[3]!;
     return new URL(req.url).pathname.endsWith('/query')?queryRead(req,{params:Promise.resolve({id})}):read(req,{params:Promise.resolve({id})});
    });
    const mixed=await invoke(['query','sales.csv',doc.id]);expect(mixed.code,JSON.stringify(mixed)).toBe(0);
    expect(mixed.result.results).toHaveLength(2);
    expect(mixed.result.results[0].result.results[0].execution).toBe('local');
    expect(mixed.result.results[0].result.results[0].rows).toEqual([{n:1},{n:2}]);
    expect(mixed.result.results[1].result.results[0].execution).toBe('remote');
    expect(mixed.result.results[1].result.results[0].rows).toEqual([{n:7}]);
    const partial=await invoke(['query','sales.csv','aB3xK9']);expect(partial.code).toBe(1);
    expect(partial.result.results[0].result.results[0].execution).toBe('local');
    expect(partial.result.results[1].error.code).toBeTruthy();
   }finally{await cli.cleanup();}
  });
  it('a dataset query naming an undeclared $parameter is refused as a 400 the agent can read, never a 500 (local eval leg: pi lost four calls to it)',async()=>{
   const token=await mintToken('mxmx_test_cli_undeclared_param');
   const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1},{n:2}],access:'readwrite'}}));expect(made.status).toBe(201);const doc=await made.json();
   const response=await queryRead(request(`/api/artifacts/${doc.id}/query`,{method:'POST',token:token.token,json:{sql:'select sum(n) as total from public.rows where ($team = \'all\' or n = $team)'}}),{params:Promise.resolve({id:doc.id})});
   expect(response.status).toBe(400);
   const body=await response.json();
   expect(body.error).toBe('invalid_sql');
   expect(body.message).toMatch(/undeclared parameter \$team/);
  });
});

describe('cli-policy-metadata', () => {
  it('metadata and dataset policy commit together with both state and policy revision checks',async()=>{
   const token=await mintToken('mxmx_test_policy_metadata');
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite',title:'Before'}}));const doc=await initial.json(),path=`/api/artifacts/${doc.id}`,context={params:Promise.resolve({id:doc.id})};
   const policy={version:1,enforcement:'enabled',tables:[{table:{schema:'public',name:'rows'},insert_permissions:[{role:'viewer',permission:{columns:['n'],check:{}}}]}]};
   const send=(body:object)=>patch(request(path,{method:'PATCH',token:token.token,json:body}),context);
   const first=await send({title:'After',policy,expectedPolicyRevision:0,expectedState:doc.state});expect(first.status,await first.clone().text()).toBe(200);const saved=await first.json();expect(saved.title).toBe('After');expect(saved.dataset_policy).toEqual(policy);expect(saved.policy_revision).toBe(1);
   expect((await send({title:'Stale',policy:null,expectedPolicyRevision:0,expectedState:saved.state})).status).toBe(409);
   const invalid=await send({title:'Invalid',policy:{...policy,tables:[{...policy.tables[0],insert_permissions:[{role:'viewer',permission:{columns:['missing'],check:{}}}]}]},expectedPolicyRevision:1,expectedState:saved.state});expect(invalid.status).toBe(400);
   const current=await (await read(request(path,{token:token.token}),context)).json();expect(current.title).toBe('After');expect(current.policy_revision).toBe(1);
   const audit=await (await getDb()).query('SELECT revision FROM dataset_policy_audit WHERE dataset_id=$1',[doc.id]);expect(audit.rows).toEqual([{revision:1}]);
   const db=await getDb();await db.query('ALTER TABLE dataset_policy_audit ADD CONSTRAINT mxmx_test_policy_audit_failure CHECK (revision<2)');
   try{await send({title:'Must roll back',shares:[{email:'mxmx_test_accidental@example.com',role:'viewer'}],policy:null,expectedPolicyRevision:1,expectedState:saved.state});}catch{/* Injected database failure can propagate through the direct handler. */}
   finally{await db.query('ALTER TABLE dataset_policy_audit DROP CONSTRAINT mxmx_test_policy_audit_failure');}
   const rolledBack=await (await read(request(path,{token:token.token}),context)).json();expect(rolledBack.title).toBe('After');expect(rolledBack.shares).toEqual([]);expect(rolledBack.policy_revision).toBe(1);
  });

  it('refuses unsupported content and policy combinations before creating or replacing data',async()=>{
   const token=await mintToken('mxmx_test_combined_policy'),policy={version:1,enforcement:'enabled',tables:[]};
   const refused=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],policy}}));expect(refused.status).toBe(400);
   expect((await (await getDb()).query('SELECT id FROM artifacts WHERE token_id=$1',[token.id])).rows).toEqual([]);
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));const doc=await initial.json();
   const context={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}`;
   const replacement=await replace(request(path,{method:'PUT',token:token.token,json:{dataset:[{n:2}],policy,expectedState:doc.state,expectedVersion:doc.version}}),context);expect(replacement.status).toBe(400);
   const current=await (await read(request(path,{token:token.token}),context)).json();expect(current.rows).toEqual([{n:1}]);expect(current.policy_revision).toBe(0);
  });
});

describe('cli-datasets-definition', () => {
  const transportFor=(calls:string[]):typeof fetch=>async(input,init)=>{
   const request=new Request(input,init);const path=new URL(request.url).pathname;calls.push(`${request.method} ${path}`);
   if(path==='/api/artifacts')return create(request);
   if(path==='/api/artifacts/preflight')return preflight(request);
   if(path==='/api/secrets')return secrets(request);
   const match=path.match(/^\/api\/artifacts\/([^/]+)(\/content)?$/);if(!match)throw new Error(`Unexpected route ${path}`);
   const context={params:Promise.resolve({id:match[1]})};
   if(match[2])return content(request,context);
   return request.method==='GET'?read(request,context):request.method==='PATCH'?metadata(request,context):replace(request,context);
  };
  const definition=[
   '<Dataset kind="stored" defaultSchema="public">',
   '  <Table schema="public" name="rows" columns={["n"]} rows={[{"n":1}]} />',
   '  <Table schema="public" name="more" columns={["m"]} rows={[{"m":2}]} />',
   '</Dataset>',
  ].join('\n')+'\n';

  it('publishes a multi-table dataset from its definition and pulls that definition back unchanged',async()=>{
   const cli=await cliWorkspace('definition-push');const root=cli.root;
   const elsewhereCli=await cliWorkspace('definition-pull');const elsewhere=elsewhereCli.root;
   const calls:string[]=[];const transport=transportFor(calls);
   const invoke=(cwd:string,args:string[])=>(cwd===elsewhere?elsewhereCli:cli).invoke(args,transport);
   try{
    const token=await mintToken('definition-owner');
    await cli.useToken(token.token);
    await elsewhereCli.useToken(token.token);
    await writeFile(join(root,'orders.jsx'),definition);
    await writeFile(join(root,'orders.yaml'),'type: dataset\nsource: orders.jsx\ntitle: Orders\nvisibility: unlisted\n');
    const published=await invoke(root,['push','orders.yaml']);
    const id=published.operations[0].id as string;expect(id).toBeTruthy();
    expect(parseResourceFile(await readFile(join(root,'orders.yaml'),'utf8')).id).toBe(id);

    // The server's own canonical definition is what a pull writes beside the YAML.
    const canonical=await(await content(new Request(`http://localhost:3000/api/artifacts/${id}/content`,{headers:{authorization:`Bearer ${token.token}`}}),{params:Promise.resolve({id})})).text();
    expect(canonical).toContain('<Dataset kind="stored"');expect(canonical).toContain('name="more"');
    await invoke(elsewhere,['pull',id,'--type','dataset','--output','orders.yaml']);
    const pulledYaml=parseResourceFile(await readFile(join(elsewhere,'orders.yaml'),'utf8'));
    expect(pulledYaml.type).toBe('dataset');expect(pulledYaml.type==='dataset'&&pulledYaml.source).toBe('orders.jsx');
    expect(await readFile(join(elsewhere,'orders.jsx'),'utf8')).toBe(canonical.endsWith('\n')?canonical:canonical+'\n');
    // Round trip: the pulled copy proposes nothing back.
    expect((await invoke(elsewhere,['push'])).operations.every((operation:{status:string})=>operation.status==='skipped')).toBe(true);

    // A reader may read the relations, never the stored rows or connection internals.
    const other=await mintToken('definition-reader');
    const reader=await content(new Request(`http://localhost:3000/api/artifacts/${id}/content`,{headers:{authorization:`Bearer ${other.token}`}}),{params:Promise.resolve({id})});
    expect(reader.status).toBe(200);const readable=await reader.text();
    expect(readable).toContain('name="more"');expect(readable).not.toContain('rows=');expect(readable).not.toContain('<Connection');
   }finally{await cli.cleanup();await elsewhereCli.cleanup();}
  });

  it('binds a connection password from the environment and writes only its secret id anywhere',async()=>{
   const cli=await cliWorkspace('definition-secret',{env:{PGPASSWORD:'hunter2'}});const root=cli.root;
   const calls:string[]=[];const transport=transportFor(calls);const output:string[]=[];
   const connected='<Dataset kind="postgres" defaultSchema="models">\n  <Connection host="db.example.com" port={5432} database="commerce" username="reader" ssl={true} />\n</Dataset>\n';
   try{
    const token=await mintToken('definition-secret');
    await cli.useToken(token.token);
    await writeFile(join(root,'orders.jsx'),connected);
    await writeFile(join(root,'orders.yaml'),'type: dataset\nsource: orders.jsx\ntitle: Orders\n');
    // Publication needs a reachable server; the binding that precedes it is what this checks.
    output.push(JSON.stringify((await cli.run(['push','orders.yaml','--secret-env','PGPASSWORD'],transport)).result));
    expect(calls[0]).toBe('POST /api/secrets');
    const written=await readFile(join(root,'orders.jsx'),'utf8');
    const secretId=written.match(/passwordSecretId="([^"]+)"/)?.[1];expect(secretId).toMatch(/^sec_[0-9a-f]{24}$/);
    for(const file of ['orders.jsx','orders.yaml'])expect(await readFile(join(root,file),'utf8')).not.toContain('hunter2');
    expect(output.join('')).not.toContain('hunter2');
    const journal=JSON.stringify(await readRecord(root,root,'pending-request','current')??'');
    const operation=JSON.stringify(await readRecord(root,root,'pending-operation','current')??'');
    expect(journal+operation).not.toContain('hunter2');

    // The secret resolves for its creator against that exact target, and nothing else.
    const actor={tokenId:token.id,userId:null};
    const target={host:'db.example.com',port:5432,database:'commerce',username:'reader',ssl:true};
    expect((await resolveDatasetConnection({...target,passwordSecretId:secretId!},actor)).password).toBe('hunter2');
    await expect(resolveDatasetConnection({...target,database:'other',passwordSecretId:secretId!},actor)).rejects.toBeInstanceOf(DatasetError);
    const other=await mintToken('definition-secret-other');
    await expect(resolveDatasetConnection({...target,passwordSecretId:secretId!},{tokenId:other.id,userId:null})).rejects.toBeInstanceOf(DatasetError);
   }finally{await cli.cleanup();}
  });

  it('a reader pulls a flat dataset as rows, because the served representation decides, not the stripped catalog',async()=>{
   const cli=await cliWorkspace('definition-reader');const root=cli.root;
   const calls:string[]=[];const transport=transportFor(calls);
   try{
    const owner=await mintToken('definition-rows-owner');
    const made=await create(new Request('http://localhost:3000/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({dataset:[{n:1},{n:2}],visibility:'unlisted'})}));
    expect(made.status).toBe(201);const doc=await made.json();
    // A reader's catalog has no objectKey: only the response representation can tell rows from a definition.
    const reader=await mintToken('definition-rows-reader');
    const head=await(await read(new Request(`http://localhost:3000/api/artifacts/${doc.id}`,{headers:{authorization:`Bearer ${reader.token}`}}),{params:Promise.resolve({id:doc.id})})).json();
    expect(head.capabilities.edit).toBe(false);expect(head.meta.catalog.tables[0].objectKey).toBeUndefined();
    await cli.useToken(reader.token);
    await cli.invoke(['pull',doc.id,'--format','yaml','--output','sales.yaml'],transport);
    const pulled=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));
    expect(pulled.type==='dataset'&&pulled.source).toBe('sales.json');
    expect(JSON.parse(await readFile(join(root,'sales.json'),'utf8'))).toEqual([{n:1},{n:2}]);
   }finally{await cli.cleanup();}
  });
});
