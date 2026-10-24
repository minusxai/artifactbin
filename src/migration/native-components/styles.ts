import {nativeDigest} from './selection.ts';
import {closeNativeResources,rewriteNativeCss,resourceSha256,type NativeResourceAsset,type NativeResourceClosure} from './resources.ts';
export interface NativeStyleSnapshot {
 sourceSha256:string;analysisSha256:string;compilerSha256:string;
 sourceFiles:readonly {path:string;sha256:string}[];
 sheets:readonly {attr:string;css:string}[];
 htmlAttributes:Record<string,string>;storyAttributes:Record<string,string>;
 inlineStyles:readonly {sourceNode:string;css:string}[];
 presentationUrls?:readonly string[];
 resourcePatches?:readonly {sourceNode:string;attributes:Record<string,string>}[];
}
export interface NativeStyleClosure extends NativeResourceClosure {
 style:{css:string;sha256:string;sourceSha256:string;htmlAttributes:Record<string,string>;storyWrapper:{tag:'div';attributes:Record<string,string>};rootSha256:string};
 analysisSha256:string;compilerSha256:string;
 htmlAttributes:Record<string,string>;storyAttributes:Record<string,string>;
 sheets:readonly {attr:string;path:string;sha256:string}[];
 inlineStyles:readonly {sourceNode:string;css:string}[];
 resourcePatches:readonly {sourceNode:string;attributes:Record<string,string>}[];
}
export function closeNativeStyles(snapshot:NativeStyleSnapshot,expected:{sourceSha256:string;analysisSha256:string;compilerSha256:string},assets:readonly NativeResourceAsset[]):NativeStyleClosure {
 if(snapshot.sourceSha256!==expected.sourceSha256||snapshot.analysisSha256!==expected.analysisSha256||snapshot.compilerSha256!==expected.compilerSha256||!snapshot.sourceFiles.length||snapshot.sourceFiles.some(file=>!/^([a-f0-9]{64})$/.test(file.sha256)))throw Error('Style source/compiler association mismatch');
 const sources=[...(snapshot.presentationUrls??[]),...snapshot.sheets.flatMap(sheet=>rewriteNativeCss(sheet.css,[]).urls),...snapshot.inlineStyles.flatMap(style=>rewriteNativeCss(style.css,[]).urls)];
 const closure=closeNativeResources(sources,assets),files=[...closure.files];
 const sheets=snapshot.sheets.map(sheet=>{
  // Sheets live in assets/, so their references must resolve beside them.
  const css=rewriteNativeCss(sheet.css,closure.urls.map(url=>({...url,target:url.target.startsWith('./assets/')?'./'+url.target.slice(9):url.target}))).css;
  const bytes=new TextEncoder().encode(css),sha256=resourceSha256(bytes),path=`assets/${sha256}.css`;
  if(!files.some(file=>file.path===path))files.push({path,bytes,sha256});
  return {attr:sheet.attr,path,sha256};
 });
 const root={sourceSha256:snapshot.sourceSha256,htmlAttributes:{...snapshot.htmlAttributes},storyWrapper:{tag:'div' as const,attributes:{...snapshot.storyAttributes}}};
 const css=sheets.map(sheet=>`@import url("./${sheet.path}");`).join('\n');
 const resourcePatches=(snapshot.resourcePatches??[]).map(patch=>({sourceNode:patch.sourceNode,attributes:Object.fromEntries(Object.entries(patch.attributes).map(([name,value])=>[name,name==='srcSet'||name==='srcset'?value.split(', ').map(part=>{const at=part.lastIndexOf(' ');const source=at<0?part:part.slice(0,at);return (closure.urls.find(url=>url.source===source)?.target??source)+(at<0?'':part.slice(at));}).join(', '):closure.urls.find(url=>url.source===value)?.target??value]))}));
 return {...closure,files,sheets,resourcePatches,style:{css,sha256:resourceSha256(css),...root,rootSha256:nativeDigest(root)},analysisSha256:snapshot.analysisSha256,compilerSha256:snapshot.compilerSha256,htmlAttributes:{...snapshot.htmlAttributes},storyAttributes:{...snapshot.storyAttributes},inlineStyles:snapshot.inlineStyles.map(style=>({...style,css:rewriteNativeCss(style.css,closure.urls).css}))};
}
