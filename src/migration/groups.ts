import {createHash} from 'node:crypto';
import type {MigrationManifest} from './contracts.ts';import type {GroupMigrationPlan} from './group-contracts.ts';
/** Group principals are never individual accounts; only exact validated memberships grant authority. */
export function planMigrationGroups(manifest:MigrationManifest,users:Record<string,string>):GroupMigrationPlan {
 const result:GroupMigrationPlan={groups:[],blocked:[]};const rows=manifest.tables.groups??[];const counts=new Map<string,number>();for(const row of rows){const id=String(row.id??'');counts.set(id,(counts.get(id)??0)+1);}
 for(const row of rows){const id=String(row.id??'');let reason='';const members:GroupMigrationPlan['groups'][number]['members']=[];const actors=new Set<string>();
  if(!id||counts.get(id)!==1)reason='Missing or ambiguous group key';
  for(const member of manifest.tables.group_members??[]){if(member.group_id!==id)continue;const actor=users[String(member.user_id)];if(!actor||!['viewer','editor'].includes(String(member.role))||actors.has(actor)){reason='Unmapped, ambiguous or unsupported group membership';continue;}actors.add(actor);members.push({actor,role:member.role as 'viewer'|'editor'});}
  // Legacy group_links are display relations, not membership or authorization; original rows remain archived.
  if(reason){result.blocked.push({legacyId:id,reason});continue;}
  result.groups.push({legacyId:id,actor:'group:'+createHash('sha256').update(JSON.stringify([manifest.sourceNamespace,id])).digest('hex'),active:!row.deleted_at,name:String(row.name??''),members});
 }
 return result;
}
