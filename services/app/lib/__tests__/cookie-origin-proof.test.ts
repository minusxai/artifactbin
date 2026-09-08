import {expect,it} from 'vitest';
import {isCrossSiteRequest} from '@/lib/http';
import {PUBLIC_BASE_URL} from '@/lib/config';

it('requires exact deployment origin and explicit CSRF proof for cookie writes',()=>{
  const origin=new URL(PUBLIC_BASE_URL).origin;
  const check=(headers:Record<string,string>)=>isCrossSiteRequest(new Request(origin+'/api/my/artifacts',{method:'POST',headers}));
  expect(check({origin,'x-artifactbin-csrf':'1'})).toBe(false);
  const attacks:Record<string,string>[]=[{},{origin},{origin:'null','x-artifactbin-csrf':'1'},
    {origin:'https://evil.test','x-artifactbin-csrf':'1','sec-fetch-site':'same-origin','x-forwarded-host':'evil.test'},
    {origin,'x-artifactbin-csrf':'1','sec-fetch-site':'same-site'}];
  for(const headers of attacks)expect(check(headers)).toBe(true);
});
