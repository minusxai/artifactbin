import {ToolError,platform} from './toolbox-client.mjs';
export async function selectedOperation(document,name,command){
 const {parse,getOperationAST}=await platform();let parsed;try{parsed=parse(document);}catch{throw new ToolError('invalid_graphql','GraphQL syntax is invalid.',2);}
 const operations=parsed.definitions.filter(node=>node.kind==='OperationDefinition');if(operations.length>1&&!name)throw new ToolError('operation_required','Select --operation for a multi-operation document.',2);
 const operation=getOperationAST(parsed,name);if(!operation||operation.operation==='subscription'||operation.operation!==(command==='mutate'?'mutation':'query'))throw new ToolError('operation_type_mismatch','Selected operation does not match query/mutate; subscriptions are unsupported.',2);return operation.operation;
}
