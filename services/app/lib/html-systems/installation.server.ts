/**
 * THE INSTALLATION DESIGN SYSTEM (`APP__DESIGN_SYSTEM_DIR`, off by default): one design system an operator supplies,
 * served exactly like a built-in, and this server's default unless `APP__DEFAULT_DESIGN_SYSTEM` names another (a
 * built-in or this one; `installDesignSystemFromSettings` checks it). The boot reads the directory once
 * (`installDesignSystemFromSettings`); anything this module would not serve refuses the boot, naming the setting and
 * the problem. Unset, nothing is registered and every output is the built-ins' alone, byte for byte.
 *
 * THE DIRECTORY is flat: `system.json` and the `.woff2` files it names, nothing else (no hidden files, symlinks or
 * subdirectories). `system.json` is the runtime subset of a built-in spec (design-systems/specs/<slug>.json), turned
 * into CSS by the generator's own code path (./system-css):
 *   slug, name                 the name pages write in their meta (lowercase kebab-case, not a built-in's) and label
 *   mood, jobs, tagline        the skill's table and the stylesheet header (optional; no `|` or line breaks)
 *   color_mode                 "light" (default) or "dark": the mode it opens in; "dark" needs dark values
 *   families                   {display, sans, mono}: CSS font-family lists; every quoted family needs a face below
 *   fonts                      [{family, file, weight, style?, stretch?, unicode_range?}]: its faces, on files here
 *   tokens                     [{name, light, dark?, usage?, group?}]: #rgb or #rrggbb; dark on every token or none
 *                              (none: light-only, `data-af-dark` never applies it dark)
 *   contract                   every theme token (background … chart-5) → a token name
 *   radius_contract            --radius, a length
 *   radius_scale               optional {sm, md, lg, full}: --radius-sm … --radius-full set explicitly (below)
 *   extra_vars, type_roles, chart_series, status_alias   as in a built-in spec, optional
 * Theme text on its ground must meet WCAG AA (4.5:1) in each mode it has: foreground on background, each
 * *-foreground on its own colour (card, popover, primary, secondary, muted, accent, destructive), and
 * muted-foreground on background.
 *
 * THE RADIUS SCALE: components read one step each, falling back to a derivation from --radius when it is unset:
 *   --radius-sm   (--radius - 4px) menu and select options, date cells, a code chip, upload file rows, data-source labels
 *   --radius-md   (--radius - 2px) buttons, inputs, textareas, selects, segmented controls, tab triggers, popovers,
 *                 tooltips, accordion items, upload drop zones, dialog controls
 *   --radius-lg   (--radius)       dialogs and tab panels
 *   --radius-full (9999px)         progress bars
 *   --radius itself                a page's own cards and the data-table frame
 * So a pill-control brand sets `radius_scale.md` (for example 100px) and keeps --radius for its cards (15px); md also
 * rounds popovers, tooltips and accordion items, which a page restyles if it must.
 *
 * FONTS serve at /af/fonts/<slug>-<file>-<hash8>.woff2: the content hash is in the name, so the answer is immutable
 * like every platform font, and nothing loads from another origin.
 */
import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {defaultDesignSystemName,designSystemDir} from '@/lib/platform';
import {HTML_SYSTEM_MODES,setDefaultHtmlSystem,setInstallationDesignSystem,type InstallationDesignSystem} from '../validation/index.ts';
import {CONTRACT_KEYS,RADIUS_STEPS,STATUS_TOKENS,specHasDark,specRules,specStylesheet,type DesignSystemSpec} from './system-css';

const SPEC_MAX_BYTES=64*1024;
const FONT_MAX_BYTES=2*1024*1024;
const FONTS_MAX=24;

class DesignSystemProblem extends Error{}

const SLUG=/^[a-z][a-z0-9-]{0,63}$/;
const NAME=/^[a-z0-9-]{1,64}$/;
const HEX=/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LENGTH=/^(?:0|\d{1,4}(?:\.\d{1,3})?(?:px|rem|em))$/;
const FAMILY_LIST=/^[A-Za-z0-9 ,"'_-]{1,200}$/;
const FAMILY=/^[A-Za-z0-9 _-]{1,64}$/;
const FONT_FILE=/^[a-z0-9-]{1,64}\.woff2$/;
const WEIGHT=/^[1-9]00(?: [1-9]00)?$/;
const STRETCH=/^\d{2,3}%(?: \d{2,3}%)?$/;
const UNICODE_RANGE=/^U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?(?:, ?U\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?)*$/;
/** A CSS value written into a declaration: no way out of it, and nothing fetched (no url(), no @import). */
const unsafeValue=(value:string)=>value.length>300||/[{}<>;\\@]|\/\*|url\s*\(|image-set\s*\(|expression\s*\(/i.test(value);
/** Text the skill's table and the stylesheet header carry. */
const unsafeText=(value:string,max:number)=>value.length>max||/[|\r\n<>`]/.test(value)||value.includes('*/');

const TOP_KEYS=['slug','name','tagline','mood','jobs','idea','use_for','avoid_when','color_mode','families','fonts','tokens','contract','radius_contract','radius_scale','extra_vars','type_roles','chart_series','status_alias'];
const TOKEN_KEYS=['name','light','dark','usage','group'];
const FONT_KEYS=['family','file','weight','style','stretch','unicode_range'];
const ROLE_KEYS=['name','family','size','lh','weight','ls','tt','fs','extra','sample','usage'];
/** Theme text on its ground: what WCAG AA (4.5:1) is checked for. */
const TEXT_PAIRS=[['foreground','background'],['card-foreground','card'],['popover-foreground','popover'],['primary-foreground','primary'],['secondary-foreground','secondary'],['muted-foreground','muted'],['muted-foreground','background'],['accent-foreground','accent'],['destructive-foreground','destructive']] as const;

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const rgb=(hex:string)=>{const full=hex.length===4?`#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`:hex;return [1,3,5].map(at=>parseInt(full.slice(at,at+2),16)/255);};
const luminance=(hex:string)=>{const [r,g,b]=rgb(hex).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);return 0.2126*r!+0.7152*g!+0.0722*b!;};
/** WCAG 2 contrast ratio of two hex colours. */
const contrastRatio=(a:string,b:string)=>{const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi!+0.05)/(lo!+0.05);};

/** Every refusal of a parsed `system.json`, as one message; a valid spec comes back typed. */
function validateDesignSystemSpec(raw:unknown,fontFiles:ReadonlySet<string>):DesignSystemSpec{
 const fail=(problem:string):never=>{throw new DesignSystemProblem(problem);};
 const unknown=(where:string,value:Record<string,unknown>,keys:readonly string[])=>{const extra=Object.keys(value).filter(key=>!keys.includes(key));if(extra.length)fail(`${where}: unknown ${extra.length>1?'keys':'key'} ${extra.join(', ')} (allowed: ${keys.join(', ')})`);};
 const text=(where:string,value:unknown,max:number,required=false)=>{if(value===undefined&&!required)return;if(typeof value!=='string'||!value.trim()||unsafeText(value,max))fail(`${where} must be text of at most ${max} characters, without | < > \` or line breaks`);};
 const cssValue=(where:string,value:unknown)=>{if(typeof value!=='string'||!value.trim()||unsafeValue(value))fail(`${where} must be a CSS value without { } < > ; \\ @, comments or url()`);};
 if(!isObject(raw))fail('system.json must be a JSON object');
 const spec=raw as Record<string,unknown>;
 unknown('system.json',spec,TOP_KEYS);
 if(typeof spec.slug!=='string'||!SLUG.test(spec.slug))fail('slug must be lowercase letters, digits and dashes, starting with a letter (at most 64)');
 const slug=spec.slug as string;
 if(Object.hasOwn(HTML_SYSTEM_MODES,slug))fail(`slug "${slug}" is a built-in design system's name; choose another`);
 text('name',spec.name,40,true);
 for(const key of ['mood','jobs'] as const)text(key,spec[key],80);
 for(const key of ['tagline','idea','use_for','avoid_when'] as const)text(key,spec[key],240);
 if(spec.color_mode!==undefined&&spec.color_mode!=='light'&&spec.color_mode!=='dark')fail('color_mode must be "light" or "dark"');
 // Families.
 if(!isObject(spec.families))fail('families must be {display, sans, mono}');
 const families=spec.families as Record<string,unknown>;
 unknown('families',families,['display','sans','mono']);
 for(const key of ['display','sans','mono'])if(typeof families[key]!=='string'||!FAMILY_LIST.test(families[key] as string))fail(`families.${key} must be a CSS font-family list (letters, digits, spaces, quotes, commas and dashes)`);
 // Fonts: faces on files in the directory.
 if(!Array.isArray(spec.fonts))fail('fonts must be a list of {family, file, weight, style?} faces (an empty list when it uses system fonts only)');
 const fonts=spec.fonts as unknown[];
 if(fonts.length>FONTS_MAX)fail(`fonts lists ${fonts.length} faces, more than ${FONTS_MAX}`);
 const faced=new Set<string>();
 fonts.forEach((face,index)=>{
  const where=`fonts[${index}]`;
  if(!isObject(face))fail(`${where} must be {family, file, weight, style?}`);
  const f=face as Record<string,unknown>;
  unknown(where,f,FONT_KEYS);
  if(typeof f.family!=='string'||!FAMILY.test(f.family))fail(`${where}.family must be a family name (letters, digits, spaces and dashes)`);
  if(typeof f.file!=='string'||!FONT_FILE.test(f.file))fail(`${where}.file must be a lowercase [a-z0-9-] name ending .woff2`);
  if(!fontFiles.has(f.file as string))fail(`${where}.file ${f.file} is missing from the directory`);
  if(typeof f.weight!=='string'||!WEIGHT.test(f.weight))fail(`${where}.weight must be "400", or a range such as "100 900"`);
  if(f.style!==undefined&&f.style!=='normal'&&f.style!=='italic')fail(`${where}.style must be "normal" or "italic"`);
  if(f.stretch!==undefined&&(typeof f.stretch!=='string'||!STRETCH.test(f.stretch)))fail(`${where}.stretch must be a percentage such as "100%"`);
  if(f.unicode_range!==undefined&&(typeof f.unicode_range!=='string'||!UNICODE_RANGE.test(f.unicode_range)))fail(`${where}.unicode_range must be a unicode-range such as "U+0000-00FF, U+20AC"`);
  faced.add(f.family as string);
 });
 for(const key of ['display','sans','mono'])for(const [,quoted] of (families[key] as string).matchAll(/["']([^"']+)["']/g))if(!faced.has(quoted!))fail(`families.${key} names "${quoted}", which no face in fonts supplies: add its .woff2 here (nothing loads from another origin) or leave it out`);
 for(const file of fontFiles)if(!fonts.some(face=>(face as {file:string}).file===file))fail(`${file} is in the directory but no face in fonts names it`);
 // Tokens.
 if(!Array.isArray(spec.tokens)||!spec.tokens.length)fail('tokens must be a non-empty list of {name, light, dark?}');
 const tokens=spec.tokens as unknown[],names=new Set<string>();
 tokens.forEach((token,index)=>{
  const where=`tokens[${index}]`;
  if(!isObject(token))fail(`${where} must be {name, light, dark?}`);
  const t=token as Record<string,unknown>;
  unknown(where,t,TOKEN_KEYS);
  if(typeof t.name!=='string'||!NAME.test(t.name))fail(`${where}.name must be lowercase [a-z0-9-]`);
  if(names.has(t.name as string))fail(`tokens: ${t.name} is declared twice`);
  names.add(t.name as string);
  for(const mode of ['light','dark'])if((mode==='light'||t[mode]!==undefined)&&(typeof t[mode]!=='string'||!HEX.test(t[mode] as string)))fail(`tokens.${t.name}.${mode} ${JSON.stringify(t[mode])} is not a colour: write #rgb or #rrggbb`);
  for(const key of ['usage','group'] as const)text(`tokens.${t.name}.${key}`,t[key],240);
 });
 const withDark=tokens.filter(token=>(token as {dark?:string}).dark!==undefined).length;
 if(withDark&&withDark!==tokens.length)fail(`tokens: ${withDark} of ${tokens.length} have a dark value; give every token one, or none for a light-only system`);
 if(!withDark&&spec.color_mode==='dark')fail('color_mode "dark" needs dark values on every token');
 // Contract.
 if(!isObject(spec.contract))fail(`contract must map every theme token (${CONTRACT_KEYS.join(', ')}) to a token`);
 const contract=spec.contract as Record<string,unknown>;
 unknown('contract',contract,CONTRACT_KEYS);
 for(const key of CONTRACT_KEYS){if(!(key in contract))fail(`contract.${key} is missing`);if(typeof contract[key]!=='string'||!names.has(contract[key] as string))fail(`contract.${key} must name a declared token`);}
 // Radius.
 if(typeof spec.radius_contract!=='string'||!LENGTH.test(spec.radius_contract))fail('radius_contract must be a length such as "8px" or "0.5rem"');
 if(spec.radius_scale!==undefined){
  if(!isObject(spec.radius_scale))fail(`radius_scale must be {${RADIUS_STEPS.join(', ')}}, each optional`);
  unknown('radius_scale',spec.radius_scale as Record<string,unknown>,RADIUS_STEPS);
  for(const [step,value] of Object.entries(spec.radius_scale as Record<string,unknown>))if(typeof value!=='string'||!LENGTH.test(value))fail(`radius_scale.${step} must be a length such as "100px"`);
 }
 // Optional runtime parts.
 if(spec.extra_vars!==undefined){
  if(!isObject(spec.extra_vars))fail('extra_vars must map names to a value or {light, dark}');
  for(const [key,value] of Object.entries(spec.extra_vars as Record<string,unknown>)){
   if(!NAME.test(key))fail(`extra_vars.${key}: names are lowercase [a-z0-9-]`);
   if(isObject(value)){unknown(`extra_vars.${key}`,value,['light','dark']);for(const [mode,v] of Object.entries(value))if(v!==null)cssValue(`extra_vars.${key}.${mode}`,v);}
   else cssValue(`extra_vars.${key}`,value);
  }
 }
 if(spec.type_roles!==undefined){
  if(!Array.isArray(spec.type_roles))fail('type_roles must be a list of {name, family, size, lh, weight}');
  (spec.type_roles as unknown[]).forEach((role,index)=>{
   const where=`type_roles[${index}]`;
   if(!isObject(role))fail(`${where} must be {name, family, size, lh, weight}`);
   const r=role as Record<string,unknown>;
   unknown(where,r,ROLE_KEYS);
   if(typeof r.name!=='string'||!NAME.test(r.name))fail(`${where}.name must be lowercase [a-z0-9-]`);
   if(r.family!=='display'&&r.family!=='sans'&&r.family!=='mono')fail(`${where}.family must be display, sans or mono`);
   for(const key of ['size','lh'])cssValue(`${where}.${key}`,r[key]);
   if(typeof r.weight==='number'?!Number.isInteger(r.weight):typeof r.weight!=='string'||!WEIGHT.test(r.weight))fail(`${where}.weight must be a weight such as 600`);
   for(const key of ['ls','tt','fs','extra'])if(r[key]!==undefined)cssValue(`${where}.${key}`,r[key]);
   for(const key of ['sample','usage'] as const)text(`${where}.${key}`,r[key],240);
  });
 }
 if(spec.chart_series!==undefined&&(!Array.isArray(spec.chart_series)||spec.chart_series.some(name=>!names.has(name as string))))fail('chart_series must list declared token names');
 if(spec.status_alias!==undefined&&spec.status_alias!==null){
  if(!isObject(spec.status_alias))fail(`status_alias must map status names (${STATUS_TOKENS.join(', ')}) to tokens`);
  unknown('status_alias',spec.status_alias as Record<string,unknown>,STATUS_TOKENS);
  for(const [key,value] of Object.entries(spec.status_alias as Record<string,unknown>))if(!names.has(value as string))fail(`status_alias.${key} must name a declared token`);
 }
 // Contrast, in each mode the system has.
 const typed=spec as unknown as DesignSystemSpec,colour=new Map(typed.tokens.map(token=>[token.name,token]));
 for(const mode of withDark?['light','dark'] as const:['light'] as const)for(const [text,ground] of TEXT_PAIRS){
  const fg=colour.get(typed.contract[text]!)!,bg=colour.get(typed.contract[ground]!)!;
  const a=mode==='dark'?fg.dark!:fg.light,b=mode==='dark'?bg.dark!:bg.light,ratio=contrastRatio(a,b);
  if(ratio<4.5)fail(`${text} (${fg.name} ${a}) on ${ground} (${bg.name} ${b}) is ${ratio.toFixed(2)}:1 in ${mode}, below WCAG AA's 4.5:1`);
 }
 return typed;
}

/** The registry entry for a valid spec and its font bytes (file → bytes). */
function installationSystem(spec:DesignSystemSpec,fontBytes:ReadonlyMap<string,Uint8Array>,faces:ReadonlyArray<{family:string;file:string;weight:string;style?:string;stretch?:string;unicode_range?:string}>):InstallationDesignSystem{
 const fonts=new Map<string,Uint8Array>(),byFamily=new Map<string,string[]>();
 for(const face of faces){
  const bytes=fontBytes.get(face.file)!,name=`${spec.slug}-${face.file.slice(0,-6)}-${createHash('sha256').update(bytes).digest('hex').slice(0,8)}.woff2`;
  fonts.set(name,bytes);
  const rule=`@font-face { font-family: ${JSON.stringify(face.family)}; font-style: ${face.style??'normal'}; font-weight: ${face.weight};${face.stretch?` font-stretch: ${face.stretch};`:''} font-display: swap; src: url(${JSON.stringify(`/af/fonts/${name}`)}) format("woff2");${face.unicode_range?` unicode-range: ${face.unicode_range};`:''} }`;
  byFamily.set(face.family,[...byFamily.get(face.family)??[],rule]);
 }
 const families=[...new Set(Object.values(spec.families).flatMap(list=>[...list.matchAll(/["']([^"']+)["']/g)].map(match=>match[1]!)))].filter(family=>byFamily.has(family));
 const faceCss=Object.fromEntries([...byFamily].map(([family,rules])=>[family,rules.join('\n')]));
 const dark=specHasDark(spec);
 return {
  slug:spec.slug,label:spec.name,mood:spec.mood??'This server\'s own',fits:spec.jobs??'Everything on this server',
  defaultMode:dark&&spec.color_mode==='dark'?'dark':'light',dark,families,faces:faceCss,
  rules:specRules(spec),css:specStylesheet(spec,families.map(family=>faceCss[family]).join('\n'),'this server\'s installation design system (APP__DESIGN_SYSTEM_DIR)'),fonts,
 };
}

/** Read and validate the directory now; throws naming APP__DESIGN_SYSTEM_DIR on anything it would not serve. */
export function readInstallationDesignSystem(dir:string):InstallationDesignSystem{
 const fail=(problem:string):never=>{throw new Error(`[boot] APP__DESIGN_SYSTEM_DIR ${JSON.stringify(dir)}: ${problem}. Fix it or unset the setting.`);};
 let names:string[]=[];
 try{if(!statSync(dir).isDirectory())fail('is not a directory');names=readdirSync(dir).sort();}
 catch(error){if((error as Error).message?.startsWith('[boot]'))throw error;fail(`cannot be read (${(error as NodeJS.ErrnoException).code??'error'})`);}
 const fontBytes=new Map<string,Uint8Array>();let specText:string|null=null;
 for(const name of names){
  if(name.startsWith('.'))fail(`${name}: hidden files are not read`);
  const stat=lstatSync(path.join(dir,name));
  if(stat.isSymbolicLink())fail(`${name}: symlinks are not read`);
  if(!stat.isFile())fail(`${name}: only files are read, no subdirectories`);
  if(name==='system.json'){if(stat.size>SPEC_MAX_BYTES)fail(`system.json: ${stat.size} bytes, more than ${SPEC_MAX_BYTES}`);specText=readFileSync(path.join(dir,name),'utf8');continue;}
  if(!FONT_FILE.test(name))fail(`${name}: the directory holds system.json and the .woff2 files it names (lowercase [a-z0-9-] names), nothing else`);
  if(stat.size>FONT_MAX_BYTES)fail(`${name}: ${stat.size} bytes, more than ${FONT_MAX_BYTES}`);
  const bytes=new Uint8Array(readFileSync(path.join(dir,name)));
  if(Buffer.from(bytes.subarray(0,4)).toString('latin1')!=='wOF2')fail(`${name}: not a WOFF2 font`);
  fontBytes.set(name,bytes);
 }
 if(specText===null)fail('has no system.json');
 let raw:unknown;
 try{raw=JSON.parse(specText!);}catch{fail('system.json is not valid JSON');}
 let spec:DesignSystemSpec;
 try{spec=validateDesignSystemSpec(raw,new Set(fontBytes.keys()));}
 catch(error){if(error instanceof DesignSystemProblem)fail(`system.json: ${error.message}`);throw error;}
 return installationSystem(spec!,fontBytes,(raw as {fonts:Parameters<typeof installationSystem>[2]}).fonts);
}

/**
 * The boot's step for both settings: read the installation system (or none) and the default's name, then register
 * them; an invalid directory, or an APP__DEFAULT_DESIGN_SYSTEM naming no system this server serves (a built-in or
 * the installation system), refuses the boot and registers nothing. The default is then the named system, else the
 * installation system, else none.
 */
export function installDesignSystemFromSettings():InstallationDesignSystem|null{
 const dir=designSystemDir(),name=defaultDesignSystemName();
 const system=dir?readInstallationDesignSystem(dir):null;
 const served=[...(system?[system.slug]:[]),...Object.keys(HTML_SYSTEM_MODES)];
 if(name!==null&&!served.includes(name))throw new Error(`[boot] APP__DEFAULT_DESIGN_SYSTEM ${JSON.stringify(name)} names no design system this server serves (one of: ${served.join(', ')}). Fix it or unset the setting.`);
 setInstallationDesignSystem(system);
 setDefaultHtmlSystem(name);
 return system;
}
