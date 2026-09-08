import type {Hono} from 'hono';
import type {Actor} from '@artifactbin/contracts';
import {attachActor} from '@artifactbin/utils';

/** An explicit in-process proxy verdict for server tests. Direct-access
 * refusals must keep using app.request(), without this fixture. */
export function proxyRequest(app:Hono,path:string,init?:RequestInit,actor:Actor={credential:'none'}) {
  return app.fetch(attachActor(new Request(new URL(path,'http://localhost:3000'),init),actor));
}
