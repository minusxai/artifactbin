import path from 'node:path';
import {parseFragment} from 'parse5';
import {parse as parseCss,walk as walkCss} from 'css-tree';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {sanitizeMermaidSvg} from './mermaid-svg.ts';
import {admitMermaid} from './mermaid-admission.ts';
import type {MermaidPreparationInput,PreparedMermaidPlan} from './mermaid-contracts.ts';
/** Migration-only dependency graph: never shipped in the published document. */
export async function prepareArchivedMermaid(root:string,input:MermaidPreparationInput):Promise<PreparedMermaidPlan[]> {
 if(!input.plans.length)return [];
 if(input.plans.length>32||new Set(input.plans.map(p=>p.id)).size!==input.plans.length||input.html.length>8e6||input.css.length>8e6)throw Error('Mermaid preparation limit');
 input.plans.forEach(p=>admitMermaid({...p}));
 if(/<\/style/i.test(input.css))throw Error('Unsafe Mermaid context stylesheet');
 const checkCss=(text:string,inline=false)=>walkCss(parseCss(text,{context:inline?'declarationList':'stylesheet'}),(node:any)=>{if(node.type==='Atrule'&&node.name.toLowerCase()==='import'||node.type==='Url'&&!/^(?:data:font\/|#)/.test(node.value))throw Error('External Mermaid context stylesheet');});
 checkCss(input.css);
 const inspect=(node:any)=>{if(node.tagName&&['script','iframe','frame','object','embed','link','base','meta'].includes(node.tagName))throw Error('Active Mermaid preparation context');for(const a of node.attrs??[]){if(/^on/i.test(a.name)||a.name==='srcdoc')throw Error('Active Mermaid preparation context');if(['src','srcset','poster'].includes(a.name)&&!a.value.startsWith('data:'))throw Error('External Mermaid preparation resource');if(a.name==='style')checkCss(a.value,true);}if(node.tagName==='style')checkCss((node.childNodes??[]).map((c:any)=>c.value??'').join(''));for(const c of node.childNodes??[])inspect(c);};inspect(parseFragment(input.html));
 const pkg=JSON.parse(await readFile(path.join(root,'node_modules/mermaid/package.json'),'utf8'));
 if(pkg.version!=='12.0.0')throw Error('Unexpected archived Mermaid version');
 const engine=path.join(root,'services/app/lib/mermaid-images/mermaid-render.ts');
 const palette=fileURLToPath(new URL('./mermaid-palette.ts',import.meta.url));
 const bundle=await build({stdin:{contents:`import {renderMermaid} from ${JSON.stringify(engine)};import {mermaidPalette} from ${JSON.stringify(palette)};globalThis.migrationMermaid={renderMermaid,mermaidPalette};`,resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',minify:true,alias:{'@':path.join(root,'services/app')},define:{'process.env.NODE_ENV':'"production"'}});
 const javascript=bundle.outputFiles[0]!.text;
 if(/\b(?:eval\s*\(|new Function|import\s*\()/.test(javascript))throw Error('Mermaid engine requires forbidden evaluation');
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15000);
  const network:string[]=[];await page.route('**/*',route=>{network.push(new URL(route.request().url()).protocol);return route.abort();});
  const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="${csp}"><style>${input.css}</style>${input.html}`);
  // Context is inert even if a caller accidentally included source scripts.
  if(await page.locator('script,iframe,object,embed,link').count())throw Error('Active Mermaid preparation context');
  await page.addScriptTag({content:javascript});
  const prepared:PreparedMermaidPlan[]=[];
  for(const plan of input.plans){
   const variants={} as PreparedMermaidPlan['variants'] as any;
   let compiledClass:string|undefined;
   for(const mode of ['light','dark']as const){
    let deadline:ReturnType<typeof setTimeout>|undefined;
    const drawn=await Promise.race([page.evaluate(async({plan,mode})=>{
     const hosts=[...document.querySelectorAll('[id]')].filter(el=>el.id===plan.id);
     if(hosts.length!==1||hosts[0]!.localName!=='figure')throw Error('Missing/ambiguous Mermaid context');
     const host=hosts[0]as HTMLElement;
     for(let el:Element|null=host;el;el=el.parentElement){if(el.classList.contains('light')||el.classList.contains('dark')){el.classList.remove('light','dark');el.classList.add(mode);}}
     document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(mode);
     const api=(globalThis as any).migrationMermaid;
     let palette=api.mermaidPalette(host,mode==='dark');
     await Promise.all([document.fonts.load(`${palette.fontSize} ${palette.fontFamily}`,plan.code),document.fonts.load(`11px ${palette.fontMono}`,plan.code)]);
     await document.fonts.ready;palette=api.mermaidPalette(host,mode==='dark');
     const image=await api.renderMermaid(plan.code,palette);
     if(!image.src.startsWith('data:image/svg+xml;charset=utf-8,'))throw Error('Unexpected Mermaid image');
     const svg=decodeURIComponent(image.src.slice('data:image/svg+xml;charset=utf-8,'.length));
     const probe=document.createElement('div');probe.innerHTML=svg;host.append(probe);
     const textWidths=[...probe.querySelectorAll('text')].map(el=>(el as SVGTextElement).getBBox().width);probe.remove();
     return {svg,palette,textWidths,type:image.type,compiledClass:host.getAttribute('class')??''};
    },{plan,mode}),new Promise<never>((_resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Mermaid preparation timeout')),15000);})]).finally(()=>clearTimeout(deadline));
    if(!["flowchart-v2","sequence"].includes(drawn.type))throw Error("Unsupported Mermaid rendered type");
    if(compiledClass!==undefined&&compiledClass!==drawn.compiledClass)throw Error('Mermaid compiled class changed');
    compiledClass=drawn.compiledClass;
    const safe=sanitizeMermaidSvg(drawn.svg);variants[mode]={...safe,type:drawn.type,palette:drawn.palette,textWidths:drawn.textWidths};
   }
   prepared.push({...plan,compiledClass:compiledClass!,variants});
  }
  if(network.length)throw Error('Mermaid attempted a network resource');
  return prepared;
 } finally {await browser.close();}
}
