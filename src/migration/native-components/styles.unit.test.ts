import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resourceSha256,closeNativeResources,rewriteNativeCss} from './resources.ts';
import {closeNativeStyles,type NativeStyleSnapshot} from './styles.ts';
const sha='a'.repeat(64),bytes=new TextEncoder().encode('font bytes'),asset={sources:['/fonts/example.woff2'],bytes,sha256:resourceSha256(bytes),extension:'woff2',provenanceSha256:sha};
const snapshot:NativeStyleSnapshot={sourceSha256:sha,analysisSha256:sha,compilerSha256:sha,sourceFiles:[{path:'pure/styles.ts',sha256:sha}],htmlAttributes:{class:'dark','data-theme':'sample'},storyAttributes:{'data-mx-story-root':'',class:'dark'},inlineStyles:[{sourceNode:'node',css:'color: red'}],sheets:[{attr:'utilities',css:'.x { color: red }'},{attr:'fonts',css:'@font-face{src:url("/fonts/example.woff2")}'},{attr:'override',css:'@import "https://fonts.example.invalid/family.css"; p { font-family: Example }'}]};
test('actual font bytes and ordered separate CSS sheets form an import bundle without moving external imports',()=>{
 const result=closeNativeStyles(snapshot,snapshot,[asset]);assert.equal(result.missing.length,0);assert.equal(result.sheets.length,3);assert.equal(result.files.length,4);assert.match(result.style.css,/^@import url\("\.\/assets\//);assert.equal(result.htmlAttributes['data-theme'],'sample');assert.ok(result.external.includes('https://fonts.example.invalid/family.css'));assert.equal(result.style.sha256,resourceSha256(result.style.css));
 const fontSheet=result.files.find(f=>f.path===result.sheets[1]!.path)!;assert.match(new TextDecoder().decode(fontSheet.bytes),/url\("\.\/[a-f0-9]+\.woff2"\)/);
});
test('digest mismatches and ambiguous versions fail instead of mapping to current bytes',()=>{
 assert.throws(()=>closeNativeResources(['/fonts/example.woff2'],[{...asset,sha256:sha}]),/digest/);
 assert.throws(()=>closeNativeResources(['/fonts/example.woff2'],[asset,{...asset,bytes:new Uint8Array([1]),sha256:resourceSha256(new Uint8Array([1]))}]),/ambiguous/);
 assert.throws(()=>closeNativeStyles(snapshot,{...snapshot,sourceSha256:'b'.repeat(64)},[asset]),/source/);
});
test('archived raw variants remain distinct; external and originally missing resources remain explicit',()=>{
 const v1={...asset,sources:['/a/example/raw?v=1'],extension:'png'},v2bytes=new Uint8Array([2]),v2={...asset,sources:['/a/example/raw?v=2'],bytes:v2bytes,sha256:resourceSha256(v2bytes),extension:'png'};
 const result=closeNativeResources(['/a/example/raw?v=1','/a/example/raw?v=2','/a/missing/raw?v=1','https://example.invalid/image.png','#section'],[v1,v2]);assert.equal(result.files.length,2);assert.notEqual(result.urls[0]!.target,result.urls[1]!.target);assert.deepEqual(result.missing,['/a/missing/raw?v=1']);assert.deepEqual(result.external,['https://example.invalid/image.png']);
});
test('CSS URL rewriting skips comments and literal text and preserves query/hash references',()=>{
 const css='/* url(/not-real) */ .x::before{content:"url(/not-real)"}.x{background:url(/fonts/example.woff2)}';const target='./assets/font.woff2';const result=rewriteNativeCss(css,[{source:'/fonts/example.woff2',target,sha256:sha}]);assert.equal(result.css,css.replace('background:url(/fonts/example.woff2)',`background:url(${target})`));assert.deepEqual(result.urls,['/fonts/example.woff2']);
});
test('canonical export selects explicit archived versions rather than dependency head and rejects changed object bytes',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {canonicalNativeAssets}=await import('./resources-canonical.ts');
 const root=await mkdtemp(join(tmpdir(),'native-assets-'));const closure=join(root,'closure');await mkdir(closure);
 const put=async(name:string,value:unknown)=>{const text=JSON.stringify(value);await writeFile(join(closure,name),text);return {path:name,sha256:resourceSha256(text)};};
 try{
 const dependency=await put('dependency.json',{heads:[{id:'example',version:2,format:'image'}],versions:[{artifact_id:'example',version:1,format:'image'}]});
 await put('manifest.json',{dependencyReceipts:[dependency],missingReferenceIds:[]});
 await put('asset-plan.json',{plan:{objects:[1,2].map(version=>({objectKey:`object-${version}`,contentType:'image/png',references:[{artifactId:'example',version,variant:'original'}]}))}});
 const objectReceipts=[];for(const version of [1,2]){const bytes=new Uint8Array([version]);await writeFile(join(closure,`object-${version}`),bytes);objectReceipts.push({objectKey:`object-${version}`,status:'copied',path:`object-${version}`,sha256:resourceSha256(bytes)});}await put('object-receipts.json',objectReceipts);
 const result=await canonicalNativeAssets(root,['/a/example/raw?v=1','ref:example']);const closed=closeNativeResources(['/a/example/raw?v=1','ref:example'],result.assets);assert.equal(closed.missing.length,0);assert.equal(closed.files.length,2);assert.notEqual(closed.urls[0]!.target,closed.urls[1]!.target);assert.equal(result.missingOriginal.length,0);
 await writeFile(join(closure,'object-1'),'changed');await assert.rejects(canonicalNativeAssets(root,['/a/example/raw?v=1']),/digest changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('source-keyed original image patches retain dimensions and rewrite both full and small bundled sources',()=>{
 const full={...asset,sources:['/a/example/raw?v=1'],extension:'png'},smallBytes=new Uint8Array([3]),small={...asset,sources:['/a/example/raw?v=1&w=64'],bytes:smallBytes,sha256:resourceSha256(smallBytes),extension:'png'};
 const result=closeNativeStyles({...snapshot,presentationUrls:[...full.sources,...small.sources],resourcePatches:[{sourceNode:'image',attributes:{src:full.sources[0]!,srcSet:`${small.sources[0]} 64w, ${full.sources[0]} 640w`,width:'640',height:'320',sizes:'100vw'}}]},snapshot,[asset,full,small]);
 const patch=result.resourcePatches[0]!;assert.equal(patch.sourceNode,'image');assert.equal(patch.attributes.width,'640');assert.equal(patch.attributes.height,'320');assert.equal(patch.attributes.sizes,'100vw');assert.match(patch.attributes.src!,/^\.\/assets\//);assert.equal(patch.attributes.srcSet,`${result.urls.find(u=>u.source===small.sources[0])!.target} 64w, ${patch.attributes.src} 640w`);
});

test('source story column and exact component recipes survive resource closure and bind into its root proof',()=>{
 const storyColumn={tag:'div' as const,attributes:{class:'mx-doc' as const}},componentRecipes=[{sourceNode:'button',tag:'Button' as const,className:'inline-flex flex-col h-auto',attributes:{'data-slot':'button','data-variant':'outline','data-size':'default'}}];
 const closed=closeNativeStyles({...snapshot,storyColumn,componentRecipes},snapshot,[asset]);
 assert.deepEqual(closed.style.storyColumn,storyColumn);assert.deepEqual(closed.componentRecipes,componentRecipes);
 assert.notEqual(closed.style.rootSha256,closeNativeStyles(snapshot,snapshot,[asset]).style.rootSha256);
});
test('reviewed navigation receipts preserve original links without fabricating resource files',async()=>{
 const {prepareNativeNavigation}=await import('./resource-navigation.ts'),{nativeDigest}=await import('./selection.ts');const identityPlan={artifactIds:{pending:'future'}},policy=prepareNativeNavigation({sourceOrigin:'https://original.example',identityPlan,approvedPlanSha256:nativeDigest(identityPlan),imports:[]});
 const result=closeNativeStyles({...snapshot,presentationUrls:['/a/pending','/a/outside']},snapshot,[asset],policy);assert.deepEqual(result.missing,[]);assert.equal(result.urls.find(url=>url.source==='/a/pending')?.target,'https://original.example/a/pending');assert.equal(result.files.length,4);assert.throws(()=>closeNativeStyles(snapshot,snapshot,[asset],{...policy,sourceOrigin:'https://changed.example'}),/navigation/);
});
