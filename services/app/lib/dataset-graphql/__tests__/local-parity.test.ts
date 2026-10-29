import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createLocalDataset} from '../local';
import {createDatasetGraphql} from '../index';
import {tableIdentity,columnIdentity,initialRowIds,ID_COLUMN} from '../model';
import type {HtmlDatasetLink,DatasetQueryRequest} from '@artifactbin/contracts';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
it('matches retained SQL query behavior over nulls, grouping, projection and pagination',async()=>{
 const db=new PGlite(),signal=new AbortController().signal,binding:HtmlDatasetLink={kind:'dataset',name:'sales',datasetId:'local_sales',mode:'live'};
 const table={schema:'public',name:'sales',columns:[{name:'team',type:'string' as const},{name:'amount',type:'number' as const}],rows:[{team:'A',amount:2},{team:'A',amount:null},{team:'B',amount:5},{team:null,amount:1}]};
 const tableId=tableIdentity(table),ids=initialRowIds('sales',tableId,'fixture',4),column=(name:string)=>columnIdentity(tableId,name);
 const local=createLocalDataset('sales',[{...table,rowIds:ids}]);
 try{
 await db.exec(`CREATE TABLE sales (team text,amount double precision,"${ID_COLUMN}" text)`);
 for(const [i,row] of table.rows.entries())await db.query(`INSERT INTO sales VALUES ($1,$2,$3)`,[row.team,row.amount,ids[i]]);
 const remote=createDatasetGraphql({snapshot:async()=>({id:'sales',revision:'remote',policyIdentity:'fixture',catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[table]},rowIds:{[tableId]:ids}}),execute:async(_a,_s,_t,statement,window)=>{
 const params:unknown[]=[],sql=statement.sql.replace(/\$(\w+)/g,(_match,key:string)=>{params.push(statement.params[key]);return `$${params.length}`;});
 return (await db.query<Record<string,unknown>>(`${sql} LIMIT ${window.limit} OFFSET ${window.offset}`,params)).rows;
 },commit:async()=>{throw new Error('unused');}});
 const requests:DatasetQueryRequest[]=[
 {tableId,first:2,columnIds:[column('team')],order:[{columnId:column('amount'),direction:'DESC'}]},
 {tableId,first:10,filters:[{columnId:column('amount'),operator:'NE',value:{type:'NUMBER',value:null}}]},
 {tableId,first:10,groupBy:[column('team')],aggregates:[{id:'count',operation:'COUNT'},{id:'sum',operation:'SUM',columnId:column('amount')},{id:'avg',operation:'AVG',columnId:column('amount')}],order:[{columnId:'sum',direction:'DESC'}]},
 {tableId,first:10,filters:[{columnId:column('amount'),operator:'GT',parameter:'min'}],parameters:[{name:'min',value:{type:'NUMBER',value:9}}],aggregates:[{id:'count',operation:'COUNT'},{id:'min',operation:'MIN',columnId:column('amount')}]}
 ];
 for(const request of requests){const a=await local.query(ANONYMOUS_ACTOR,binding,request,signal),b=await remote.query(ANONYMOUS_ACTOR,binding,request,signal);expect(a.rows).toEqual(b.rows);expect(a.columns).toEqual(b.columns);expect(a.source).toEqual(b.source);expect(a.pageInfo.hasNextPage).toBe(b.pageInfo.hasNextPage);}
 }finally{await db.close();}
});
