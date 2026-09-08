import {it,expect} from 'vitest';
import {browserGateHeaders} from '../lib/gate-request.mjs';
it('models same-origin browser requests without forwarding a path or credentials',()=>{
 expect(browserGateHeaders('http://localhost:5802/account?secret=hidden')).toEqual({'Content-Type':'application/json',origin:'http://localhost:5802','sec-fetch-site':'same-origin','x-artifactbin-csrf':'1'});
});
