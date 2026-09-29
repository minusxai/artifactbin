import {randomUUID} from 'node:crypto';
/** Shared authored SQL for the real PostgreSQL gate and its local compiler check. */
export const modelNoticeSql = `select ARRAY[$recipient, $recipient]::text[] as "to", 'West total ' || total::text as message from models.region_totals where region = 'west'`;
export const physicalNoticeSql = `select $recipient::text as "to", 'Order ' || id::text as message from sales.orders where id = 1`;
export const invalidRecipientSql = `select json_build_array($recipient)::text as "to", 'Invalid recipient representation' as message from models.region_totals where region = 'west'`;

export function notificationDocumentPayload({triggerId,recipientId,modelDatasetId,datasetId,invalid=false}) {
  const rule = (name, source, sql) => `<Notify name="${name}" on="save" source="ref:${source}">{\`${sql}\`}</Notify>`;
  const markup = `<Helmet>
<Import name="requests" src="ref:${triggerId}" />
<Value name="recipient" type="string" default="${recipientId}" />
<Mutation name="save" expectedAffected={1}>{\`update requests.rows set recipient = $recipient where id = 1\`}</Mutation>
${rule('model_notice', modelDatasetId, modelNoticeSql)}
${rule('duplicate_notice', modelDatasetId, modelNoticeSql)}
${rule('physical_notice', datasetId, physicalNoticeSql)}
${invalid ? rule('invalid_notice', modelDatasetId, invalidRecipientSql) : ''}
</Helmet>
<h1 id="pg-notify">PostgreSQL notification contract</h1>`;

  return {markup,visibility:"unlisted",title:"PostgreSQL notification contract"};
}
export function notificationMutationPayload(recipientId) {
  return {mutation:"save",args:{recipient:recipientId},operationKey:randomUUID()};
}
