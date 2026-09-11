/** One API registry projected into the versioned local bundle. */
import {expect,it} from 'vitest';
import {OPERATIONS} from '../registry';
import teaching from '../../../../cli/src/generated/teaching.json';
it('documents every operation address and recovery code in local help',()=>{
 const api=teaching.files['references/api.md'];
 for(const op of OPERATIONS){
  expect(api,op.name).toContain(`${op.http.method} ${op.http.path}`);
  for(const error of op.errors)expect(api,`${op.name}:${error.code}`).toContain(error.code);
 }
 expect(api).not.toMatch(/MCP|\/docs\//);
});
