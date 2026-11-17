/** Native cancellation cannot free capacity until the original operation has server completion. */
import { expect, it, vi } from 'vitest';
import { trackPostgresOperation } from '../src/postgres-operation';
const pending = () => {
  let resolve!:(value:number)=>void, reject!:(error:unknown)=>void;
  const query=Object.assign(new Promise<number>((yes,no)=>{resolve=yes;reject=no;}),{state:{pid:42,secret:99},canceller:vi.fn(async()=>{})});
  return {query,resolve,reject};
};
class ServerError extends Error {}
const serverError=(e:unknown)=>e instanceof ServerError;

it('waits for actual operation completion after native cancel dispatch and sends only once',async()=>{
 const p=pending(), cancel=p.query.canceller, op=trackPostgresOperation(p.query,serverError);
 const result=op.result.catch(()=>{});
 let stopped=false;
 const first=op.stop().then(()=>{stopped=true;}), second=op.stop();
 await new Promise(resolve=>setTimeout(resolve,10));
 expect(cancel).toHaveBeenCalledExactlyOnceWith(p.query);
 expect(stopped).toBe(false);expect(op.confirmed).toBe(false);
 p.reject(new ServerError('cancelled'));
 await Promise.all([first,second,result]);expect(op.confirmed).toBe(true);
});
it('never accepts a disconnected operation as completion',async()=>{
 const p=pending(),op=trackPostgresOperation(p.query,serverError);
 const result=op.result.catch(()=>{}),stopped=op.stop();
 p.reject(new Error('CONNECTION_CLOSED'));
 await expect(stopped).rejects.toMatchObject({code:'unavailable'});await result;
 expect(op.confirmed).toBe(false);
});
it('observes cancel transport errors and still awaits server completion',async()=>{
 const p=pending();p.query.canceller.mockRejectedValue(new Error('cancel transport failed'));
 const op=trackPostgresOperation(p.query,serverError);
 let stopped=false;const stop=op.stop().then(()=>{stopped=true;});
 await new Promise(resolve=>setTimeout(resolve,10));expect(stopped).toBe(false);
 p.resolve(7);await stop;expect(await op.result).toBe(7);
});
it('does not send stale cancellation after natural completion',async()=>{
 const p=pending(),op=trackPostgresOperation(p.query,serverError),cancel=p.query.canceller;
 p.resolve(1);await op.result;await op.stop();expect(cancel).not.toHaveBeenCalled();
});
it('permits retirement of a query cancelled before driver dispatch',async()=>{
 const p=pending();Object.assign(p.query,{state:null});
 const op=trackPostgresOperation(p.query,serverError),result=op.result.catch(()=>{});
 p.reject(new Error('not dispatched'));await result;await op.stop();expect(op.confirmed).toBe(true);
});
it('refuses missing driver cancellation capability',async()=>{
 const p=pending();Object.assign(p.query,{canceller:null});
 const op=trackPostgresOperation(p.query,serverError);
 await expect(op.stop()).rejects.toMatchObject({code:'unavailable'});
 p.resolve(1);await op.result;
});
