import {Hono} from 'hono';
import {actorReceiver,actorOf} from '@artifactbin/utils';
/** Prototype of the signed HTTP twin. Uses existing transport; no product registration. */
export function runnerHttp(runner,secret){
 const app=new Hono();actorReceiver(secret).mount(app);
 app.use('*',async(c,next)=>{if(!actorOf(c.req.raw)?.userId)return c.json({error:'unauthorized'},401);await next();});
 app.post('/v1/runs',async c=>{const actor=actorOf(c.req.raw),body=await c.req.json();if(body.userId!==actor.userId)return c.json({error:'identity_mismatch'},403);return c.json(await runner.start(body),202);});
 app.get('/v1/runs/:id',async c=>{try{return c.json(await runner.inspect(c.req.param('id'),actorOf(c.req.raw).userId));}catch{return c.json({error:'not_found'},404);}});
 app.get('/v1/runs/:id/events',async c=>{try{await runner.inspect(c.req.param('id'),actorOf(c.req.raw).userId);const after=Number(c.req.query('after')??0);return c.json((await runner.db.query('SELECT sequence,event FROM design_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence',[c.req.param('id'),after])).rows);}catch{return c.json({error:'not_found'},404);}});
 app.post('/v1/runs/:id/cancel',async c=>{try{await runner.inspect(c.req.param('id'),actorOf(c.req.raw).userId);await runner.stop(c.req.param('id'));return c.json({ok:true});}catch{return c.json({error:'not_found'},404);}});
 return app;
}
