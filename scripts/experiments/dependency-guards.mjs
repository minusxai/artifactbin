/** Native PG guard proof, independent of the AST encoding. This does NOT certify JSX.
 * An operation validator must supply a complete dependency set. These tests distinguish
 * write/write conflicts, read/write conflicts and independent writes in one current row.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

export async function auditDependencyGuards(pool){
 const q=pool.query.bind(pool),checks=[];
 await q("CREATE TABLE dependency_audit(id text PRIMARY KEY, version int NOT NULL, facets jsonb NOT NULL, revisions jsonb NOT NULL DEFAULT '{}')");
 const reset=()=>q("INSERT INTO dependency_audit VALUES('one',1,$1::jsonb,'{}') ON CONFLICT(id) DO UPDATE SET version=1,facets=EXCLUDED.facets,revisions='{}'",[JSON.stringify({a:'A',b:'B',declaration:'label',uses:[],parent:'section'})]);
 const commit=async({base=1,reads=[],writes})=>{
  assert.ok(Number.isSafeInteger(base)&&base>=1);assert.ok(Object.keys(writes).length);
  const keys=[...new Set([...reads,...Object.keys(writes)])];
  const params=[base,JSON.stringify(writes)];
  const parameter=key=>{params.push(key);return `$${params.length}::text`;};
  const guards=keys.map(key=>`COALESCE((revisions->>${parameter(key)})::int,0)<=$1`);
  const revisions=Object.keys(writes).map(key=>`${parameter(key)},version+1`).join(',');
  return (await q(`UPDATE dependency_audit SET
    facets=facets || $2::jsonb,
    revisions=revisions || jsonb_build_object(${revisions}),
    version=version+1
   WHERE id='one' AND version >= $1
    AND ${guards.join(' AND ')}
   RETURNING *`,params)).rows;
 };
 await reset();
 assert.equal((await commit({writes:{a:'new A'}})).length,1);
 assert.equal((await commit({writes:{b:'new B'}})).length,1);
 checks.push('independent writes from one base both succeed');
 await reset();
 for(let i=0;i<23;i++)assert.equal((await commit({base:i+1,writes:{a:String(i)}})).length,1);
 assert.equal((await commit({writes:{b:'23 versions behind'}})).length,1);
 checks.push('23-version lag is accepted without replay or a version-history scan');
 await reset();
 await commit({writes:{a:'temporary'}});await commit({base:2,writes:{a:'A'}});
 assert.equal((await commit({writes:{a:'stale ABA'}})).length,0);
 checks.push('revisions reject ABA even when the old value is restored');
 // D deletes a declaration; U inserts a distant use. They write different facets.
 // Complete reads make either ordering safe, including a queued concurrent UPDATE.
 for(const order of ['delete-first','use-first']){
  await reset();
  const deletion={reads:['uses'],writes:{declaration:null}},use={reads:['declaration'],writes:{uses:['paragraph-b']}};
  const first=order==='delete-first'?deletion:use,second=order==='delete-first'?use:deletion;
  assert.equal((await commit(first)).length,1);assert.equal((await commit(second)).length,0);
 }
 checks.push('non-ancestor declaration/use conflict rejects the second writer in either order');
 await reset();
 const both=await Promise.all([commit({reads:['uses'],writes:{declaration:null}}),commit({reads:['declaration'],writes:{uses:['paragraph-b']}})]);
 assert.equal(both.filter(rows=>rows.length).length,1);
 checks.push('concurrent semantic write skew is prevented by one-row predicates');
 await reset();
 await commit({writes:{parent:'For'}});
 assert.equal((await commit({reads:['parent'],writes:{a:'old-scope expression'}})).length,0);
 checks.push('an operation compiled in an old ancestry/scope is refused');
 await reset();
 assert.equal((await commit({reads:['declaration','uses'],writes:{declaration:'other',uses:['other']}})).length,1);
 checks.push('a composite modifies namespace and consumers in one statement');
 // Without the semantic read dependencies, the same allowed writes both commit. The
 // primitive store is working correctly; the admission contract would be unsound.
 await reset();await commit({writes:{declaration:null}});await commit({writes:{uses:['paragraph-b']}});
 const invalid=(await q("SELECT facets FROM dependency_audit WHERE id='one'")).rows[0].facets;
 assert.equal(invalid.declaration,null);assert.deepEqual(invalid.uses,['paragraph-b']);
 checks.push('negative control: omitting semantic reads admits the invalid combination');
 // A real held row lock ensures the dependent UPDATE is already executing before
 // the mutation commits; READ COMMITTED must re-evaluate the row's new revisions.
 await reset();const connection=await pool.connect();let pending;
 try{
  await connection.query('BEGIN');
  await connection.query("UPDATE dependency_audit SET version=2, facets=jsonb_set(facets,'{parent}','\"For\"'),revisions='{\"parent\":2}' WHERE id='one'");
  pending=commit({reads:['parent'],writes:{a:'must not commit'}});
  for(let i=0;;i++){
   const waiting=(await q("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE dependency_audit SET%'")).rows[0].n;
   if(waiting)break;assert.ok(i<100,'dependent UPDATE did not wait on the lock');await new Promise(r=>setTimeout(r,10));
  }
  await connection.query('COMMIT');assert.equal((await pending).length,0);
 }finally{await connection.query('ROLLBACK');connection.release();if(pending)await pending;}
 checks.push('dependency guards re-evaluate after an already-held row lock');
 // Preserve the failed query shape as evidence. PostgreSQL may pull a correlated
 // NOT EXISTS into an anti-join that reads dependency state from a pre-wait scan.
 // The approved compiler emits scalar predicates directly on the UPDATE target.
 const indirectSql=`UPDATE dependency_audit SET facets=facets || $3::jsonb,version=version+1
  WHERE id='one' AND version >= $1
   AND NOT EXISTS(SELECT 1 FROM unnest($2::text[]) AS key WHERE COALESCE((revisions->>key)::int,0)>$1)
  RETURNING *`;
 const plan=(await q('EXPLAIN (FORMAT JSON) '+indirectSql,[1,['parent','a'],JSON.stringify({a:'stale'})])).rows;
 writeFileSync('/tmp/artifact-dependency-subquery-plan.json',JSON.stringify(plan,null,2));
 return checks;
}
