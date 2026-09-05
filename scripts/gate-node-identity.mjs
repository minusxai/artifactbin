/** Built-server acceptance: source identity, atomic moves, relation-only comments. */
import assert from 'node:assert/strict';
import { startDocument } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://localhost:3000';
const started = await startDocument(base);
const path = `/api/artifacts/${started.id}`;
async function call(route, method = 'GET', body, cookie) {
  return fetch(`${base}${route}`, {method, headers:{
    'Content-Type':'application/json',
    ...(cookie ? {Cookie:cookie, Origin:base} : {Authorization:`Bearer ${started.token}`}),
  }, body:body === undefined ? undefined : JSON.stringify(body)});
}
async function ok(route, method, body, cookie) {
  const response = await call(route, method, body, cookie);
  assert(response.ok, `${method ?? 'GET'} ${route}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const read = () => ok(path);
const edit = (body) => ok(`${path}/edits`, 'POST', body);
await ok(path, 'PUT', {markup:'<main id="root"><Card id="card">Hello</Card><p id="other">Old</p><section id="dest"></section></main>'});
const initial = await read();
const session = await call('/api/session/token', 'POST', {token:started.token});
assert.equal(session.status,204);
const cookie = session.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
assert(cookie);
const commentPath = `/api/my/artifacts/${started.id}/annotations`;
const comment = await ok(commentPath, 'POST', {node_id:'card',body:'Keep this card'},cookie);
assert.equal((await read()).edit_id, initial.edit_id, 'comment creates no document edit');
await edit({edit_id:initial.edit_id,old_string:'Old',new_string:'Current'});
const moved = await edit({edit_id:initial.edit_id,edits:[
  {old_string:'<Card id="card">Hello</Card>',new_string:''},
  {old_string:'<section id="dest">',new_string:'<section id="dest"><Card id="card">Hello</Card>'},
]});
assert.equal(moved.version, initial.version+2);
assert(moved.markup.includes('Current'));
assert(moved.markup.includes('<section id="dest"><Card id="card">Hello</Card></section>'));
assert.equal(moved.markup.match(/id="card"/g)?.length,1);
const beforeFailure = await read();
const failed = await call(`${path}/edits`,'POST',{edit_id:beforeFailure.edit_id,edits:[
  {old_string:'Hello',new_string:'Changed'}, {old_string:'absent-target',new_string:'x'},
]});
assert.equal(failed.status,400);
assert.equal((await failed.json()).edit_index,1);
assert.equal((await read()).edit_id,beforeFailure.edit_id);
for (const action of [{reply:'Moved successfully'},{resolve:true},{reopen:true}]) {
  await ok(`${commentPath}/${comment.id}`,'POST',action,cookie);
  assert.equal((await read()).edit_id,beforeFailure.edit_id,'comment action cannot edit source');
}
await ok(`${commentPath}/${comment.id}`,'DELETE',undefined,cookie);
assert.equal((await read()).edit_id,beforeFailure.edit_id);
// Whole-document replacement archives the previous head; rapid edits may
// deliberately coalesce intermediate version snapshots.
await ok(path,'PUT',{markup:beforeFailure.markup+'<p id="temporary">Temporary</p>'});
const reverted = await ok(`${path}/revert`,'POST',{version:beforeFailure.version});
assert(reverted.markup.includes('<Card id="card">Hello</Card>'));
assert.equal(reverted.markup.match(/id="card"/g)?.length,1);
console.log('PASS: atomic stale-base move, rollback, all five relation-only actions, identity-preserving revert');
