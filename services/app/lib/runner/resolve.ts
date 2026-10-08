import {getArtifactById,canReadArtifact} from '../artifacts';
import {declarationsForRow} from '../artifacts/dataflow';
import {EMPTY_COMPILED_DATAFLOW} from '../story/data/compiled-dataflow';
import {parseJsx} from '../jsx';
import {bareHelmetScript,splitHelmet,validateHelmet} from '../story/document/helmet';
import {buildLambdaModule} from './program.server';
import type {LambdaProgramResolver} from '../runner';
/** One published JSX source supplies both declarations and the executable entry point. */
export const resolveLambdaProgram:LambdaProgramResolver=async(artifactId,userId)=>{
 const row=await getArtifactById(artifactId);
 if(!row||row.deleted_at||row.format!=='markup'||!row.source||!await canReadArtifact(row,{userId,email:null}))return null;
 const parsed=parseJsx(row.source);if(!parsed.ok)return null;
 const errors=validateHelmet(parsed.nodes);if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
 const split=splitHelmet(parsed.nodes),{serverScript}=split.content;
 const legacy=bareHelmetScript(split);
 // Compatibility: a previously published untyped Lambda keeps its old invocation contract.
 // Explicit server code always wins; new artifacts should use type="server".
 const handler=serverScript??legacy;if(!handler)return null;
 const declared=await declarationsForRow(row);
 if(declared?.state&&Object.keys(declared.state.errors).length)throw Error('invalid_lambda_declarations');
 return {version:String(row.version),document:{source:row.source,editId:row.edit_id},program:{source:await buildLambdaModule(handler,declared?.flow??EMPTY_COMPILED_DATAFLOW),language:'javascript'}};
};
