import {it,expect,vi,beforeEach} from 'vitest';
import type {ClientConfig} from 'pg';
import type {ConnectionOptions} from 'node:tls';
import {resetPgFixture,type PgFixture} from '@/test/helpers/pg-mock';
const fixture=vi.hoisted(():PgFixture=>({active:0,maximum:0}));
vi.mock('pg',async()=>(await import('@/test/helpers/pg-mock')).pgModule(fixture));
vi.mock('node:dns/promises',()=>({lookup:vi.fn(async()=>[{address:'172.20.1.2',family:4}])}));
vi.mock('@/lib/platform/config',async()=>{const {datasetSecretTargetHash}=await import('../secret-crypto');return {DATASET_ALLOW_PRIVATE_NETWORKS:false,DATASET_DNS_SERVERS:[],DATASET_PRIVATE_TARGET_HASHES:[datasetSecretTargetHash({host:'reviewed.example.test',port:5432,database:'fixture',username:'reader',ssl:true})]};});
import {discoverPostgres} from '../postgres';
const target={host:'reviewed.example.test',port:5432,database:'fixture',username:'reader',ssl:true,password:'fixture-password'};
beforeEach(()=>resetPgFixture(fixture));
it('pins only the vetted private address and keeps the configured TLS identity after tuple approval',async()=>{
 await discoverPostgres(target);const options=fixture.options as ClientConfig;expect(options.host).toBe('172.20.1.2');expect(options.ssl).toMatchObject({rejectUnauthorized:true,servername:target.host});expect((options.ssl as ConnectionOptions).checkServerIdentity).toBeTypeOf('function');
});
it.each([{host:'unreviewed.example.test'},{port:5433},{database:'other'},{username:'other'},{ssl:false}])('refuses tuple changes before any private connection %j',async change=>{
 await expect(discoverPostgres({...target,...change})).rejects.toThrow('Postgres connection failed');expect(fixture.options).toBeUndefined();
});
