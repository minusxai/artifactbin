import {afterEach,expect,it,vi} from 'vitest';
vi.mock('node:http',()=>({request:vi.fn(()=>{throw Error('unexpected network request');})}));
vi.mock('node:https',()=>({request:vi.fn(()=>{throw Error('unexpected network request');})}));
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {fetchWebResource,setWebIngestPolicyForTests} from '../fetch';
afterEach(()=>{setWebIngestPolicyForTests(null);vi.clearAllMocks();});
it.each(['::ffff:7f00:1','::ffff:127.0.0.1','0:0:0:0:0:ffff:a9fe:a9fe'])('refuses mapped %s before creating a request',async host=>{
  setWebIngestPolicyForTests({allowPrivate:false,allowHttp:false});
  await expect(fetchWebResource(`https://[${host}]/`,{maxBytes:100})).rejects.toMatchObject({code:'forbidden_address'});
  expect(httpRequest).not.toHaveBeenCalled();expect(httpsRequest).not.toHaveBeenCalled();
});
