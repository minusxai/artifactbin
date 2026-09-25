/** Lower client-validated text lineage to conditional sidecar updates. Reads
 * current annotation relations inside the document commit, including comments
 * added since the client loaded. All offsets remain UTF-16 integer offsets. */
export function documentAnnotationSql(operations:string):string {
 return `annotation_steps AS MATERIALIZED (
  SELECT row_number() OVER(ORDER BY op.ordinal,m.ordinal)::int AS step,op.value->>'id' AS operation_id,
   op.value->>'kind' AS kind,m.value AS mapping
  FROM jsonb_array_elements(${operations}::jsonb) WITH ORDINALITY op(value,ordinal)
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(op.value->'maps','[null]'::jsonb)) WITH ORDINALITY m(value,ordinal) ON true
 ), annotation_saved AS MATERIALIZED (
  SELECT r AS receipt FROM artifact_edits e CROSS JOIN LATERAL jsonb_array_elements(e.annotation_changes) r
  WHERE e.artifact_id=$1 AND r->>'direction'='map'
   AND EXISTS(SELECT 1 FROM annotation_steps s WHERE s.operation_id=r->>'operationId')
 ), annotation_walk AS (
  SELECT a.id,0 AS step,a.anchor_key AS original_anchor,a.range AS original_range,
   a.anchor_key AS anchor,a.range AS range,'[]'::jsonb AS receipts
  FROM annotations a WHERE a.artifact_id=$1 AND a.root_id IS NULL AND a.deleted_at IS NULL
   AND EXISTS(SELECT 1 FROM updated) AND EXISTS(SELECT 1 FROM annotation_steps)
  UNION ALL
  SELECT w.id,s.step,w.original_anchor,w.original_range,COALESCE(next.relation->>'anchor',w.anchor),
   CASE WHEN next.relation IS NULL THEN w.range ELSE next.relation->>'range' END,
   w.receipts||CASE WHEN next.relation IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object(
    'operationId',s.operation_id,'direction',s.kind,'annotationId',w.id,
    'before',jsonb_build_object('anchor',w.anchor,'range',w.range),'after',next.relation)) END
  FROM annotation_walk w JOIN annotation_steps s ON s.step=w.step+1
  LEFT JOIN LATERAL (
   SELECT jsonb_build_object('anchor',s.mapping->>'toId','range',jsonb_set(w.range::jsonb,'{parts,0}',
    (w.range::jsonb#>'{parts,0}')||jsonb_build_object('start',(segment->>'to')::int+(w.range::jsonb#>>'{parts,0,start}')::int-(segment->>'from')::int,
     'end',(segment->>'to')::int+(w.range::jsonb#>>'{parts,0,end}')::int-(segment->>'from')::int))::text) AS relation
   FROM jsonb_array_elements(s.mapping->'segments') segment
   WHERE s.kind='map' AND w.anchor=s.mapping->>'fromId' AND w.range IS NOT NULL
    AND COALESCE(w.range::jsonb->>'kind','text') NOT IN ('area','target') AND jsonb_array_length(w.range::jsonb->'parts')=1
    AND w.range::jsonb#>>'{parts,0,rel}'='' AND (segment->>'from')::int<=(w.range::jsonb#>>'{parts,0,start}')::int
    AND (segment->>'from')::int+(segment->>'length')::int>=(w.range::jsonb#>>'{parts,0,end}')::int
    AND NOT EXISTS(SELECT 1 FROM annotation_saved r WHERE r.receipt->>'operationId'=s.operation_id)
   UNION ALL
   SELECT CASE WHEN s.kind='undo' THEN r.receipt->'before' ELSE r.receipt->'after' END
   FROM annotation_saved r WHERE s.kind IN ('undo','redo') AND r.receipt->>'operationId'=s.operation_id AND r.receipt->>'annotationId'=w.id
    AND CASE WHEN s.kind='undo' THEN r.receipt->'after' ELSE r.receipt->'before' END=jsonb_build_object('anchor',w.anchor,'range',w.range)
   LIMIT 1
  ) next ON true
 ), moved_annotations AS (
  UPDATE annotations a SET anchor_key=w.anchor,range=w.range FROM annotation_walk w
  WHERE w.step=(SELECT max(step) FROM annotation_steps) AND a.id=w.id
   AND a.anchor_key=w.original_anchor AND a.range IS NOT DISTINCT FROM w.original_range
   AND (a.anchor_key IS DISTINCT FROM w.anchor OR a.range IS DISTINCT FROM w.range)
  RETURNING a.id,w.receipts
 ), annotation_receipts AS (
  SELECT COALESCE(jsonb_agg(receipt),'[]'::jsonb) AS receipts FROM (
   SELECT r AS receipt FROM moved_annotations a CROSS JOIN LATERAL jsonb_array_elements(a.receipts) r
   UNION ALL SELECT DISTINCT jsonb_build_object('operationId',s.operation_id,'direction',s.kind,'annotationId','',
    'before',jsonb_build_object('anchor','','range',null),'after',jsonb_build_object('anchor','','range',null)) FROM annotation_steps s
  ) receipts
 )`;
}
