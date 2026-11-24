/** Native HTML assets from the existing design-system specifications; no second token catalogue. */
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {REPO,ROSTER,SHARED_TOKENS,SHARED_TYPE_ROLES,loadSpec,typeCss} from './pages.mjs';
import {varsMap} from './runtime.mjs';
import {packagedFontFaces} from './packaged-fonts.mjs';
const ROOT=path.join(REPO,'services/app/skills/artifactbin');
import {TOKEN_RULES,tokenRuleCss} from './token-colors.mjs';
const tokenCss=selector=>TOKEN_RULES.map(rule=>`${rule.names.map(name=>`${selector} .tok-${name}`).join(', ')} { ${tokenRuleCss(rule)}; }`).join('\n');

/**
 * A system's rules without its font faces: variables (light, dark), base body, type roles, highlight tokens.
 * The variable blocks sit in `:where()`: the system's tokens are defaults, so a page's own `:root{--muted:…}` always
 * overrides them; dark follows light in source order, so it still wins over light. The base body, type roles and
 * highlight tokens keep their specificity, so a page's own `body{…}` keeps its old precedence.
 * The skill's readable copy (`comments`) keeps the plain selectors: only the served platform stylesheet needs the
 * cascade, and the archive's bytes stay as they were.
 * `comments` adds the skill copy's documentation beside each value; the platform stylesheet is built without it.
 */
export function nativeSystemRules(slug,{comments=false}={}){
 const spec=loadSpec(slug),selector=`:root[data-af-design-system="${slug}"]`;
 const usage=new Map(spec.tokens.map(token=>[`--ds-${token.name}`,token.usage]));
 const note=text=>String(text??'').replaceAll('*/','* /').replace(/\s+/g,' ').trim();
 const vars=(mode,documented)=>Object.entries(varsMap(spec,mode)).map(([key,value])=>`  ${key}: ${value};${documented&&comments&&usage.get(key)?` /* ${note(usage.get(key))} */`:''}`).join('\n');
 const roles=typeCss(spec).replaceAll(`.ds-${slug}`,selector).split('\n').map((rule,index)=>{
  const role=spec.type_roles[index];
  return comments&&role?`/* ${note(role.usage)} */\n${rule}`:rule;
 }).join('\n');
 const lead=text=>comments?`/* ${text} */\n`:'';
 const zero=sel=>comments?sel:`:where(${sel})`;
 return `${lead('Light values; --ds-* are this system\'s own palette, each annotated with its use.')}${zero(selector)} {\n${vars('light',true)}\n}\n${lead('Dark values: the same tokens, under data-af-dark="true".')}${zero(`${selector}[data-af-dark="true"]`)} {\n${vars('dark',false)}\n}\n${selector} body { margin:0; background:var(--background); color:var(--foreground); font-family:var(--font-body); }\n${lead('Type roles and when to use them.')}${roles}\n${lead('Code highlighting token colours (for @afbin/highlight).')}${tokenCss(selector)}\n`;
}
/** The comment that opens every shipped stylesheet: how a page uses it, the contract all systems share, this system's brief. */
function cssHeader(slug){
 const spec=loadSpec(slug),note=text=>String(text??'').replaceAll('*/','* /').replace(/\s+/g,' ').trim();
 // Wrap prose to a readable width, each line prefixed as a comment line.
 const wrap=(text,indent='')=>{const lines=[];let line='';for(const word of text.split(' ')){if((indent+line+' '+word).length>112&&line){lines.push(indent+line);line=word;}else line=line?line+' '+word:word;}if(line)lines.push(indent+line);return lines.map(text=>` * ${text}`).join('\n');};
 return `/*
 * ${spec.name}: ${note(spec.tagline)}
${wrap(`${note(spec.jobs)}. Mood: ${note(spec.mood)}. Opens ${spec.color_mode}. Generated from design-systems/specs/${slug}.json.`)}
 *
${wrap(`Use <meta name="artifactbin:design-system" content="${slug}"> in <head>. The platform loads the CSS and fonts and sets data-af-design-system and data-af-dark.`)}
 *
${wrap('Shared contract: every system defines these, so build your CSS on them with var(--name):')}
${wrap(SHARED_TOKENS.join(' '),'  ')}
${wrap('Type-role classes shared by every system, used as class="t-title" etc.:')}
${wrap(SHARED_TYPE_ROLES.join(' '),'  ')}
${wrap('The --ds-* palette and any unlisted type roles are system-specific.')}
 *
${wrap(`Idea: ${note(spec.idea)}`)}
${wrap(`Use for: ${note(spec.use_for)}`)}
${wrap(`Avoid when: ${note(spec.avoid_when)}`)}
 */
`;
}
export function nativeSystemCss(slug){
 const spec=loadSpec(slug);
 return `${cssHeader(slug)}${nativeSystemRules(slug,{comments:true})}\n/* Font faces: the platform hosts these files; they stay here so the sheet is complete on its own. */\n${packagedFontFaces(spec.fonts.map(([family])=>family))}\n`;
}
const HTML_SYSTEMS=path.join(REPO,'services/app/lib/html-systems/html-systems.ts');
const HTML_SYSTEM_MODES=path.join(REPO,'services/app/lib/validation/html-system-modes.ts');
/**
 * The platform stylesheet's data (lib/html-systems): every system's rules, and one set of font faces per family with
 * absolute /af/fonts/ URLs (the platform's immutable font files). A tiny leaf carries the names and default modes for
 * code that must not carry the rules (the core's assembly).
 */
export function renderHtmlSystems(){
 const families=new Map();
 const systems=Object.fromEntries(ROSTER.map(slug=>{const spec=loadSpec(slug),names=[...new Set(spec.fonts.map(([family])=>family))];
  for(const family of names)if(!families.has(family))families.set(family,packagedFontFaces([family]));
  return [slug,{label:spec.name,defaultMode:spec.color_mode==='dark'?'dark':'light',families:names,rules:nativeSystemRules(slug)}];}));
 const faces=Object.fromEntries([...families].sort(([a],[b])=>a<b?-1:a>b?1:0));
 const header='/** GENERATED by scripts/design-systems.mjs from design-systems/specs — do not edit. */\n';
 const data=`${header}/** Shared theme tokens for pages, components and hosts. */\nexport const THEME_TOKENS = ${JSON.stringify(SHARED_TOKENS)} as const;\n/** Per system: label, default colour mode, font families and its rules (lib/html-systems assembles the stylesheet). */\nexport const HTML_SYSTEMS = ${JSON.stringify(systems,null,1)} as const;\n/** One set of @font-face rules per family, on the platform's /af/fonts/ files. */\nexport const HTML_SYSTEM_FACES: Readonly<Record<string, string>> = ${JSON.stringify(faces,null,1)};\n`;
 const modes=`${header}/** The design systems an HTML page may name, with the colour mode each opens in. A dependency-free leaf. */\nexport const HTML_SYSTEM_MODES: Readonly<Record<string, 'light' | 'dark'>> = ${JSON.stringify(Object.fromEntries(ROSTER.map(slug=>[slug,loadSpec(slug).color_mode==='dark'?'dark':'light'])),null,1)};\n`;
 return {data,modes};
}
export function writeHtmlSystems(){
 const {data,modes}=renderHtmlSystems();
 mkdirSync(path.dirname(HTML_SYSTEMS),{recursive:true});writeFileSync(HTML_SYSTEMS,data);writeFileSync(HTML_SYSTEM_MODES,modes);
 return [[HTML_SYSTEMS,data],[HTML_SYSTEM_MODES,modes]].map(([file,text])=>({path:file,bytes:Buffer.byteLength(text)}));
}
export {HTML_SYSTEMS as HTML_SYSTEMS_FILE,HTML_SYSTEM_MODES as HTML_SYSTEM_MODES_FILE};
/** The shipped stylesheets, design-systems/NAME.css. The design-system guides are gone: SKILL.md carries the catalogue. */
export function writeNativeSkill(slugs=ROSTER){
 return slugs.map(slug=>{const file=path.join(ROOT,`design-systems/${slug}.css`),text=nativeSystemCss(slug);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,text);return {path:file,bytes:Buffer.byteLength(text)};});
}
