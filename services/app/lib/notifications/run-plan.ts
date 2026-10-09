import type {MutationNotificationPlan,NotificationSource} from '@artifactbin/contracts';
interface NotificationRecipientPlan {recipientId:string;messages:string[];sources:NotificationSource[]}
/** Collapse all rows/rules to one recipient plan; retain every contributing source. */
export function notificationRecipients(plan:MutationNotificationPlan):NotificationRecipientPlan[]{
 const recipients=new Map<string,NotificationRecipientPlan>();
 const messages=new Map<string,Set<string>>(),sources=new Map<string,Set<string>>();
 for(const rule of plan.rules)for(const row of rule.rows)for(const recipientId of new Set(row.recipientIds)){
  let target=recipients.get(recipientId);
  if(!target){target={recipientId,messages:[],sources:[]};recipients.set(recipientId,target);messages.set(recipientId,new Set());sources.set(recipientId,new Set());}
  if(!messages.get(recipientId)!.has(row.message)){messages.get(recipientId)!.add(row.message);target.messages.push(row.message);}
  for(const source of rule.sources){
   const key=JSON.stringify([source.artifactId,source.authorityRevision,source.schemaRevision]);
   if(!sources.get(recipientId)!.has(key)){sources.get(recipientId)!.add(key);target.sources.push(source);}
  }
 }
 return [...recipients.values()];
}
