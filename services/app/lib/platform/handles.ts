/** One reservation boundary shared by account and group identity. Call inside the owning transaction. */
import type {Queryable} from './db';
export const RESERVED_HANDLES=new Set(['admin','root','support','help','about','settings','security','artifactbin','artifact_bin','api','docs','mcp','oauth','a','login','tokens']);
export async function reserveHandle(query:Queryable,handle:string,kind:'user'|'group',id:string):Promise<void>{
 // Backfill legacy account handles before any new claim. Existing names always win.
 await query.query("INSERT INTO handle_reservations(handle,kind,subject_id) SELECT username,'user',id FROM users WHERE username IS NOT NULL ON CONFLICT DO NOTHING");
 await query.query('DELETE FROM handle_reservations WHERE kind=$1 AND subject_id=$2 AND handle<>$3',[kind,id,handle]);
 const existing=(await query.query<{kind:string;subject_id:string}>('SELECT kind,subject_id FROM handle_reservations WHERE handle=$1',[handle])).rows[0];
 if(existing&&(existing.kind!==kind||existing.subject_id!==id)){const error=Object.assign(new Error('Handle is taken'),{code:'23505'});throw error;}
 await query.query('INSERT INTO handle_reservations(handle,kind,subject_id) VALUES($1,$2,$3) ON CONFLICT(handle) DO UPDATE SET handle=EXCLUDED.handle WHERE handle_reservations.kind=EXCLUDED.kind AND handle_reservations.subject_id=EXCLUDED.subject_id RETURNING handle',[handle,kind,id]).then(result=>{if(!result.rows.length)throw Object.assign(new Error('Handle is taken'),{code:'23505'});});
}
