import {describe,expect,it} from 'vitest';
import {createAppServer} from '../app';
import {useAppHarness} from '@/__tests__/harness';

/** Public execution products have no allocation or protocol endpoint in v3. */
interface RetiredRequest {path:string;methods:Array<'GET'|'POST'|'DELETE'|'PATCH'>}
const retired:RetiredRequest[]=[
 {path:'/api/remote/sessions',methods:['GET','POST']},
 {path:'/api/remote/sessions/example',methods:['GET','POST','DELETE']},
 {path:'/api/remote/sessions/example/exchange',methods:['POST']},
 {path:'/api/remote/hosted/operations',methods:['POST']},
 {path:'/api/sessions',methods:['GET']},{path:'/api/sessions/example',methods:['GET','DELETE']},
 {path:'/api/runs',methods:['POST']},{path:'/api/run-capabilities',methods:['GET']},
 {path:'/api/runs/example',methods:['GET']},{path:'/api/runs/example/events',methods:['GET']},
 {path:'/api/runs/example/cancel',methods:['POST']},{path:'/api/artifacts/example/runs',methods:['POST']},
 {path:'/api/schedules',methods:['GET','POST']},{path:'/api/schedules/example',methods:['GET','PATCH','DELETE']},
 {path:'/api/schedules/example/run',methods:['POST']},{path:'/api/schedules/example/history',methods:['GET']},
 {path:'/api/artifacts/example/schedules',methods:['GET','POST']},
];
describe('retired execution products',()=>{
 useAppHarness();
 const app=createAppServer({actorSecret:'test-secret',indexHtml:async()=>'<html></html>'});
 it('answers every former product endpoint with not found',async()=>{
  for(const {path,methods} of retired)for(const method of methods){
   const response=await app.request(path,{method});
   expect(response.status,`${method} ${path}`).toBe(404);
  }
 });
});
