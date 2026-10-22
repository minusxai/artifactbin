import type {Converter} from './contracts.ts';
import {convertLegacyJsx,convertLegacyDocument,legacyDocumentSource} from './conversion/index.ts';
import type {MigrationConversionOptions} from './conversion-strategy-contracts.ts';
/** Prefer retained markup; canonical JSON alone must never become an empty page. */
export const convertMigrationContent: Converter = input => input.source.trim()
 ? convertLegacyJsx({source:input.source,coreUrl:input.coreUrl})
 : input.document !== null && input.document !== undefined
 ? convertLegacyDocument(input.document,{coreUrl:input.coreUrl})
 : {classification:'manual-blocked',html:null,issues:['Missing source content'],identities:{}};
/** Explicit strategies, never a hidden retry through a less restrictive compiler. */
export function createMigrationConverter(options:MigrationConversionOptions):Converter {
 if(options.strategy==='strict')return async input=>({...await convertMigrationContent(input),strategy:'strict'});
 if(options.strategy!=='archived-static')throw new Error('Unknown migration conversion strategy');
 if(!options.legacyRoot&&!options.compiler)throw new Error('Archived-static conversion requires an explicit archived compiler root');
 return async input=>{
  let source:string|null;try{source=input.source.trim()?input.source:legacyDocumentSource(input.document);}catch{source=null;}
  if(source===null)return {classification:'manual-blocked',html:null,issues:[{code:'document-codec',message:'Archived document cannot be reconstructed'}],identities:{},strategy:'archived-static'};
  const {compileArchivedStatic}=await import('./conversion/compiled/index.ts');
  const meta=input.meta??{};
  const result=await compileArchivedStatic({source,coreUrl:input.coreUrl,resourceMap:input.resourceMap,theme:typeof meta.theme==='string'?meta.theme:null,template:typeof meta.template==='string'?meta.template:null,colorMode:meta.colorMode==='dark'?'dark':'light'},{legacyRoot:options.legacyRoot,compiler:options.compiler});
  return {...result,strategy:'archived-static'};
 };
}
