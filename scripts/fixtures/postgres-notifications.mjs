/** Shared authored SQL for the real PostgreSQL gate and its local compiler check. */
export const modelNoticeSql = `select ARRAY[$recipient, $recipient]::text[] as "to", 'West total ' || total::text as message from models.region_totals where region = 'west'`;
export const physicalNoticeSql = `select $recipient::text as "to", 'Order ' || id::text as message from sales.orders where id = 1`;
export const invalidRecipientSql = `select json_build_array($recipient)::text as "to", 'Invalid recipient representation' as message from models.region_totals where region = 'west'`;
