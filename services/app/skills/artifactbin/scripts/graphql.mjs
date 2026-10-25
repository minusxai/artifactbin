import {readFile} from 'node:fs/promises';
import {runTool,resolveTarget,selectedServer,makeClient,integer,positional,requireFlags,jsonFile,platform,ToolError} from './toolbox-client.mjs';
import {selectedOperation} from './toolbox-graphql.mjs';
export async function graphqlCommand({sub,values,positionals},options={}){
 const {server,id}=resolveTarget(positional(positionals),selectedServer(values,options.env)),client=makeClient(server,options);
 const revision=values.revision?String(integer(values.revision,'revision')):undefined;
 let document;if(sub!=='schema'){requireFlags(values,['document']);document=await readFile(values.document,'utf8');await selectedOperation(document,values.operation,sub);}
 const schema=await client.request(`/api/artifacts/${id}/graphql${revision?'?revision='+revision:''}`);
 if(sub==='schema')return schema;
 const variables=values.variables?await jsonFile(values.variables):{};if(!variables||typeof variables!=='object'||Array.isArray(variables))throw new ToolError('invalid_variables','Variables must be a JSON object.',2);
 const {parse,validate,buildSchema}=await platform();const errors=validate(buildSchema(schema.sdl),parse(document));if(errors.length)throw new ToolError('graphql_validation','Operation does not match the saved page SDL.',2,'Use graphql.mjs schema for exact names.',{errors:errors.map(error=>error.message)});
 const result=await client.request(`/api/artifacts/${id}/graphql`,{method:'POST',body:{query:document,revision:schema.revision,variables,...(values.operation?{operationName:values.operation}:{})},unsafe:sub==='mutate'});
 const outcomes=Object.values(result.extensions?.outcomes??{});
 if(result.errors?.length||outcomes.some(outcome=>outcome!=='committed'))throw new ToolError(outcomes.includes('unknown')?'outcome_unknown':'graphql_failed','GraphQL returned errors or noncommitted outcomes.',outcomes.includes('unknown')?5:1,'Inspect errors/outcomes; reconcile unknown mutations before any new write.',result);
 return result;
}
await runTool('graphql',import.meta.url,graphqlCommand);
