import * as ts from 'typescript';
import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAuthorProgramAdmission} from './author-program-contracts.ts';
import {resourceSha256} from './resources.ts';

type Selection=Pick<NativeAuthorProgramAdmission,'key'|'sourceNode'|'profile'|'filter'|'scriptSha256'>;
const fileName='/__native_ordinary_dom_author_profile__.js';
const options:ts.CompilerOptions={allowJs:true,checkJs:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,lib:['lib.es2022.d.ts','lib.dom.d.ts'],types:[],skipLibCheck:true};
const unsupportedGlobals=new Set(['fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource','Worker','SharedWorker','importScripts','WebAssembly','WebXRSystem','XRSystem','XRSession','WebGLRenderingContext','WebGL2RenderingContext','DecompressionStream','CompressionStream','localStorage','sessionStorage','eval','Function','globalThis']);
const unsupportedProperties=new Set(['clipboard','xr','serviceWorker','sendBeacon','localStorage','sessionStorage','cookie']);
const globalRoots=new Set(['window','document','navigator','location','history']);

function scriptText(node:RetainedJsxNode):string|undefined{
 if(node.type!=='element'||node.tag!=='script'||node.attributes.length)return undefined;
 let text='';
 for(const child of node.children){if(child.type==='text')text+=child.value;else if(child.type==='expression'&&child.value.static&&typeof child.value.json==='string')text+=child.value.json;else return undefined;}
 return text;
}
export function nativeOrdinaryDomUnsupportedCapability(script:string,allowedUnboundNames:ReadonlySet<string>=new Set(),allowedGlobals:ReadonlySet<string>=new Set()):boolean{
 const source=ts.createSourceFile(fileName,script,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if((source as ts.SourceFile&{parseDiagnostics:readonly ts.Diagnostic[]}).parseDiagnostics.length)return true;
 let rejected=false;
 const host=ts.createCompilerHost(options),getSourceFile=host.getSourceFile.bind(host),fileExists=host.fileExists.bind(host),readFile=host.readFile.bind(host);
 host.getSourceFile=(name,languageVersion,onError,shouldCreateNewSourceFile)=>name===fileName?source:getSourceFile(name,languageVersion,onError,shouldCreateNewSourceFile);
 host.fileExists=name=>name===fileName||fileExists(name);
 host.readFile=name=>name===fileName?script:readFile(name);
 const program=ts.createProgram([fileName],options,host),checker=program.getTypeChecker();
 const diagnostics=program.getSemanticDiagnostics(source);
 if(diagnostics.some(d=>d.code===2304&&!allowedUnboundNames.has(script.slice(d.start??0,(d.start??0)+(d.length??0)))))return true; // Unbound names need a separate host capability.
 const symbolIsGlobal=(node:ts.Identifier):boolean=>{
  const symbol=checker.getSymbolAtLocation(node);
  return !!symbol?.declarations?.some(declaration=>declaration.getSourceFile()!==source);
 };
 const propertyIsKnown=(base:ts.Expression,name:string):boolean=>{
  const type=checker.getTypeAtLocation(base);
  return checker.getPropertyOfType(type,name)!==undefined;
 };
 const visit=(node:ts.Node):void=>{
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)||ts.isExportAssignment(node))rejected=true;
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)rejected=true;
  // Classic-script source becomes module code: exported declarations and top-level `this` change meaning there.
  if(ts.canHaveModifiers(node)&&ts.getModifiers(node)?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword))rejected=true;
  if(node.kind===ts.SyntaxKind.ThisKeyword&&!ts.findAncestor(node.parent,ancestor=>ts.isClassLike(ancestor)||ts.isFunctionLike(ancestor)&&!ts.isArrowFunction(ancestor)))rejected=true;
  if(ts.isIdentifier(node)&&node.text==='globalThis')rejected=true;
  if(ts.isIdentifier(node)&&unsupportedGlobals.has(node.text)&&symbolIsGlobal(node)&&!allowedGlobals.has(node.text))rejected=true;
  if(ts.isPropertyAccessExpression(node)){
   if(globalRoots.has(node.expression.kind===ts.SyntaxKind.Identifier?(node.expression as ts.Identifier).text:'')){
    if(unsupportedProperties.has(node.name.text)||!propertyIsKnown(node.expression,node.name.text))rejected=true;
   }
   if(node.name.text==='getContext'&&node.parent&&ts.isCallExpression(node.parent)&&node.parent.arguments.some(arg=>ts.isStringLiteral(arg)&&/^(?:experimental-)?webgl2?$/i.test(arg.text)))rejected=true;
  }
  if(ts.isElementAccessExpression(node)&&ts.isIdentifier(node.expression)&&globalRoots.has(node.expression.text)&&node.argumentExpression&&ts.isStringLiteral(node.argumentExpression)){
   const name=node.argumentExpression.text;
   if(unsupportedProperties.has(name)||!propertyIsKnown(node.expression,name))rejected=true;
  }
  ts.forEachChild(node,visit);
 };
 visit(source);
 return rejected;
}

/** Select scripts that need only standard browser DOM APIs and can run byte-for-byte as ordinary page code. */
export function selectNativeOrdinaryDomAuthorProfiles(analysis:NativeTypedAnalysis):readonly Selection[]{
 const nodes:RetainedJsxNode[]=[];
 const visit=(items:readonly RetainedJsxNode[])=>{for(const node of items){nodes.push(node);if(node.type==='element')visit(node.children);}};
 visit(analysis.nodes);
 return nodes.flatMap(node=>{
  const script=scriptText(node);
  if(script===undefined||nativeOrdinaryDomUnsupportedCapability(script))return [];
  return [{key:{...analysis.key},sourceNode:node.graphKey,profile:'ordinary-dom-script' as const,filter:'search' as const,scriptSha256:resourceSha256(script)}];
 });
}
