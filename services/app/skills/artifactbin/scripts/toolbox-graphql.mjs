/** Internal: picks and validates the one operation to send from a GraphQL document, and maps a
 * dataset API failure to the command's exit codes.
 * Used by: graphql.mjs, author-toolbox.test.ts, graphql-dataset-toolbox.test.ts. */
import {ToolError,platform} from './toolbox-client.mjs';
export async function selectedOperation(document,name,command){
const {parse,getOperationAST}=await platform();let parsed;try{parsed=parse(document);}catch{
   throw new ToolError('invalid_graphql','GraphQL syntax is invalid.',2);}
const operations=parsed.definitions.filter(node=>node.kind==='OperationDefinition');if(
   operations.length>1&&!name)throw new ToolError('operation_required',
   'Select --operation for a multi-operation document.',2);
const operation=getOperationAST(parsed,name);if(!operation||operation.operation==='subscription'||
   operation.operation!==(command==='mutate'?'mutation':'query'))throw new ToolError(
   'operation_type_mismatch',
   'Selected operation does not match query/mutate; subscriptions are unsupported.',2);
   return operation.operation;
}
/** A dataset reply with errors (or a failed request) as a ToolError: an unknown outcome exits 5,
 * a changed dataset 4, a denied rule 3, anything else 1; a mutation keeps its idempotency key
 * (and, when its outcome is unknown, says how to replay it). */
export function datasetFailure(failure,key){
 const thrown=failure instanceof Error;
 const codes=thrown?[failure.code]:(failure.errors??[]).map(e=>e?.extensions?.code);
 const unknown=codes.includes('outcome_unknown');
 const exit=unknown?5:thrown?failure.exit??1:codes.includes('dataset_changed')?4:
  codes.includes('permission_denied')?3:1;
 const replay=unknown&&key?` Repeat it with --idempotency-key ${key}: it applies at most once.`:'';
 const details=(thrown?failure.details:failure)??{};
 return new ToolError(unknown?'outcome_unknown':thrown?failure.code:'graphql_failed',
  unknown?'Write outcome is unknown.':thrown?failure.message:'GraphQL returned errors.',exit,
  (unknown?'Read the rows before any other write.':thrown?failure.recovery:
  'Inspect errors[].extensions.code.')+replay,{...details,...(key?{idempotencyKey:key}:{})});
}
