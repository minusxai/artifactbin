import {it,expect,vi} from 'vitest';
import {createDomainSql} from '../domain-reads';
import {RemoteUnreachable} from '../apollo/apollo-contracts';
const location={href:'https://blog.example.org/abc123-sales?x=1'};
it('sends an export capture\'s sql to the page SQL door with the key, read-only, and never sql without a key',async()=>{
 const rows={columns:[{name:'n',type:'integer'}],rows:[{n:2}]};
 const send=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(rows)));
 const capture=createDomainSql({pageId:'abc123',revision:'2'},{href:'http://localhost:3030/a/abc123/raw?chrome=0&key=123.abc.def'},send);
 const statement={sql:'select count(*) as n from sales',params:{p0:1}};
 expect(await capture(statement)).toEqual(rows);
 const [url,init]=send.mock.calls[0]!;
 expect(String(url)).toBe('http://localhost:3030/api/artifacts/abc123/sql');
 expect(init).toMatchObject({method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'text/plain;charset=UTF-8'}});
 expect(JSON.parse(String(init!.body))).toEqual({sql:'select count(*) as n from sales',params:{p0:1},revision:'2',readOnly:true,key:'123.abc.def'});
 // A refusal reaches the page's sql as the door's own answer.
 send.mockImplementationOnce(async()=>new Response(JSON.stringify({error:'permission_denied',message:'no'}),{status:403}));
 expect(await capture(statement)).toEqual({error:'permission_denied',message:'no'});
 // An owner host's page carries no key: its sql never leaves the page.
 await expect(createDomainSql({pageId:'abc123',revision:'2'},location,send)(statement)).rejects.toBeInstanceOf(RemoteUnreachable);
 expect(send).toHaveBeenCalledTimes(2);

});
