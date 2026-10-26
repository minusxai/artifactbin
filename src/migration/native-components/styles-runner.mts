/** Read-only retained pure-style extraction. Never evaluate authored scripts or load schemas. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]!);let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>16*1024*1024)throw Error('Style input limit');}
const request=JSON.parse(input),load=(name:string)=>import(pathToFileURL(path.join(root,'services/app/lib',name)).href);
const [{graphNodes,graphSource},{splitHelmet},{documentStyleSheets,DOCUMENT_ROOT_CSS},{documentFonts},{storySystemSheetCss},{resolveStoryMode},{STORY_ROOT_ATTR,STORY_STYLED_ATTR},{STORY_ROOT_ID},{rawBuildProps},{reactAttrs},{imageRefData,resolveRefProps}]=await Promise.all([
 load('document/document-graph.ts'),load('document/helmet.ts'),load('page-styles/document-styles.ts'),load('page-styles/document-fonts.ts'),load('data/story/story-system-sheets.ts'),load('data/story/story-themes.ts'),load('story-surface/index.ts'),load('story-runtime/contract.ts'),load('story-ui/interpreter-primitives.ts'),load('compiled-page/static-solid/attrs.ts'),load('dataflow/ref-data.ts')
]);
const [{RECIPES},{cn},{refName}]=await Promise.all([load('islands/kit/recipes/basic.ts'),load('islands/kit/recipes/cn.ts'),load('dataflow/dataflow.ts')]);
const {RECIPES:STATIC_RECIPES}=await load('islands/kit/recipes/static.ts');
const recipeSlots:Record<string,string>={Button:'button',Card:'card',CardHeader:'card-header',CardTitle:'card-title',CardDescription:'card-description',CardContent:'card-content',CardFooter:'card-footer',CardAction:'card-action',Alert:'alert',AlertTitle:'alert-title',AlertDescription:'alert-description',Badge:'badge',Table:'table',TableHeader:'table-header',TableBody:'table-body',TableFooter:'table-footer',TableRow:'table-row',TableHead:'table-head',TableCell:'table-cell',TableCaption:'table-caption'};
const componentRecipes:{sourceNode:string;tag:string;className:string;actionWrapper?:'mutation-hint';presentationWrapper?:'table-container';attributes:Record<string,string>}[]=[];
const nodes=graphNodes(request.document),{content}=splitHelmet(nodes),mode=resolveStoryMode(request.theme,request.colorMode);
const htmlAttributes:Record<string,string>={class:mode,...(request.theme?{'data-theme':request.theme}:{})},storyAttributes:Record<string,string>={id:STORY_ROOT_ID,'data-mx-inline-story':'',[STORY_ROOT_ATTR]:'',...htmlAttributes};
const refData=Object.fromEntries((request.refRows??[]).filter((row:any)=>row.format==='image').map((row:any)=>[row.id,imageRefData(row)]));
const presentationUrls:string[]=[],resourcePatches:{sourceNode:string;attributes:Record<string,string>}[]=[];
const inlineStyles:{sourceNode:string;css:string}[]=[];let styled=false;
const visit=(node:any,row=false)=>{if(node.type!=='element')return;const cls=node.attributes.find((a:any)=>['class','className'].includes(a.name));if(cls?.value.static&&typeof cls.value.json==='string')styled=true;
 if(node.attributes.some((a:any)=>a.name==='style'&&a.value.static)){const props=rawBuildProps(node.attributes,node.isComponent,node.tag,'');const css=reactAttrs('div',{style:props.style}).find(([name]:[string,string])=>name==='style')?.[1];if(css)inlineStyles.push({sourceNode:node.graphKey,css});}
 const props=rawBuildProps(node.attributes,node.isComponent,node.tag,'');
 if(recipeSlots[node.tag]&&!node.attributes.some((a:any)=>['class','className','variant','size'].includes(a.name)&&!a.value.static)){
  const attributes:Record<string,string>={'data-slot':typeof props['data-slot']==='string'?props['data-slot']:recipeSlots[node.tag]!};
  if(node.tag==='Button'){attributes['data-variant']=String(props.variant??'default');attributes['data-size']=String(props.size??'default');if(row&&refName(props.run))attributes.type='button';}
  componentRecipes.push({sourceNode:node.graphKey,tag:node.tag,className:cn((RECIPES[node.tag]??STATIC_RECIPES[node.tag])!(props)),...(node.tag==='Table'?{presentationWrapper:'table-container' as const}:{}),...(node.tag==='Button'&&(refName(props.run)||props.set)?{actionWrapper:'mutation-hint' as const}:{}),attributes});
 }
 if(!['Import','Context'].includes(node.tag)){for(const name of ['href','src','poster'])if(typeof props[name]==='string'&&!/^\$_row\.[A-Za-z_]\w*$/.test(props[name] as string))presentationUrls.push(props[name] as string);}
 const patch=resolveRefProps(node,props,refData);if(patch){const attributes:Record<string,string>={};for(const [name,value]of Object.entries(patch)){if(name==='style'){const css=reactAttrs('div',{style:value}).find(([name]:[string,string])=>name==='style')?.[1];if(css)attributes.style=css;}else if(typeof value==='string'||typeof value==='number')attributes[name]=String(value);}resourcePatches.push({sourceNode:node.graphKey,attributes});for(const [name,value]of Object.entries(attributes)){if(name==='src')presentationUrls.push(value);if(name==='srcSet')presentationUrls.push(...value.split(', ').map(part=>part.slice(0,part.lastIndexOf(' '))));}}
 node.children.forEach((child:any)=>visit(child,row||node.tag==='For'||node.tag==='Column'));};nodes.forEach((node:any)=>visit(node));if(styled)storyAttributes[STORY_STYLED_ATTR]='';
// Match the retained reader: missing or stale stored CSS is compiled from the exact graph source.
const {currentStoryCss}=await load('data/story/story-css.server.ts');
const compiledCss=await currentStoryCss({compiledCss:request.compiledCss,cssCompileVersion:request.cssCompileVersion},graphSource(request.document));
const sheets=[{attr:'data-mx-root',css:DOCUMENT_ROOT_CSS},...documentStyleSheets({compiledCss,chrome:true,bare:false,theme:request.theme,docFonts:documentFonts(content),systemCss:storySystemSheetCss(request.theme),authorCss:null})];
process.stdout.write(JSON.stringify({componentRecipes,storyColumn:{tag:'div',attributes:{class:'mx-doc'}},sheets,htmlAttributes,storyAttributes,inlineStyles,presentationUrls,resourcePatches}));
