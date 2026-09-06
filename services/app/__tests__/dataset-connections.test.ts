import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
import {saveConnection,listConnections,connectionConfig} from '@/lib/datasets/connections';
useAppHarness();
const config={name:'Warehouse',host:'localhost',port:5432,database:'analytics',username:'reader',password:'private-test-password',ssl:true};
it('stores credentials outside public connection metadata and scopes discovery to its owner',async()=>{
 const a=await mintToken('owner'), b=await mintToken('other');
 const owner={tokenId:a.id,userId:null},other={tokenId:b.id,userId:null};
 const c=await saveConnection(owner,config);
 expect(JSON.stringify(c)).not.toContain(config.password);
 expect(await listConnections(other)).toEqual([]);
 expect(await listConnections(owner)).toEqual([c]);
 await expect(connectionConfig(c.id,other)).rejects.toThrow(/not found/i);
 expect((await connectionConfig(c.id,owner)).password).toBe(config.password);
 const db=await getDb();const stored=await db.query('SELECT * FROM dataset_connections WHERE id=$1',[c.id]);
 expect(JSON.stringify(stored.rows)).not.toContain(config.password);
});
it('preserves an omitted password during edits and refuses invalid connection input',async()=>{
 const a=await mintToken('owner'); const owner={tokenId:a.id,userId:null};
 const c=await saveConnection(owner,config);
 await saveConnection(owner,{...config,password:'',name:'Renamed'},c.id);
 expect((await connectionConfig(c.id,owner)).password).toBe(config.password);
 await expect(saveConnection(owner,{...config,port:-1})).rejects.toThrow();
 await expect(saveConnection(owner,{...config,host:'https://example.com'})).rejects.toThrow();
});
