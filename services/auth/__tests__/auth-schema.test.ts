import {afterAll,expect,it} from 'vitest';
import {ensureAuthSchema} from '../src/schema';
import {testDb} from './helpers';

afterAll(async()=>{await testDb().pg().close();});

// Bearer admission finds a token's refresh-family membership by its access token id on every OAuth
// request; without this partial expression index that lookup scans every credential row.
it('indexes refresh-token membership by access token id',async()=>{
 const {query}=testDb();
 await ensureAuthSchema({query},'auth');
 const rows=(await query<{indexdef:string}>("SELECT indexdef FROM pg_indexes WHERE schemaname='auth' AND indexname='idx_auth_credentials_access'")).rows;
 expect(rows.map(row=>row.indexdef)).toEqual(["CREATE INDEX idx_auth_credentials_access ON auth.credentials USING btree (((payload ->> 'access_token_id'::text))) WHERE (kind = 'refresh_token'::text)"]);
});
