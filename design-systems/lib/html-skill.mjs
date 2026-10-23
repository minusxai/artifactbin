/** Native HTML assets from the existing design-system specifications; no second token catalogue. */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {REPO,ROSTER,loadSpec,typeCss} from './pages.mjs';
import {varsMap} from './runtime.mjs';
import {fontFaceCss} from './fonts.mjs';
const ROOT=path.join(REPO,'services/app/skills/artifactbin');
const cell=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ');
export function nativeSystemCss(slug){
 const spec=loadSpec(slug),selector=`:root[data-af-design-system="${slug}"]`;
 const vars=mode=>Object.entries(varsMap(spec,mode)).map(([key,value])=>`  ${key}: ${value};`).join('\n');
 return `/* Generated from design-systems/specs/${slug}.json. */\n${spec.fonts.map(([family,axes])=>fontFaceCss(family,axes)).join('\n')}\n${selector} {\n${vars('light')}\n}\n${selector}[data-af-dark="true"] {\n${vars('dark')}\n}\n${selector} body { margin:0; background:var(--background); color:var(--foreground); font-family:var(--font-body); }\n${typeCss(spec).replaceAll(`.ds-${slug}`,selector)}\n`;
}
export function nativeSystemMd(slug){
 const s=loadSpec(slug);
 return `---\nname: html-system-${slug}\ndescription: Native HTML tokens, typography and composition for ${s.name}, generated from its retained specification.\n---\n## Read first\n\n**${s.name}: ${s.tagline}** ${s.jobs}. ${s.mood}; opens ${s.color_mode}.\n\n## Bind ordinary HTML\n\nSet \`<html data-af-design-system="${slug}" data-af-dark="${s.color_mode==='dark'}">\`. Copy the installed \`design-systems/${slug}.css\` into \`<style data-af="design-system">\` in the head. It provides the exact retained light/dark tokens, font faces and type-role classes. Keep authored layout CSS in a separate style block. There is no theme metadata or automatic kit stylesheet.\n\nUse normal \`class="t-title"\` etc. Pick a layout for this content; these assets provide typography and tokens, not a component or utility compiler. Font faces need their network URLs; system fallbacks preserve readable content offline. A downloaded page never includes account credentials.\n\n## Color and typography\n\n| Token | Light | Dark |\n|---|---|---|\n${s.tokens.map(t=>`| \`--ds-${t.name}\` | ${cell(t.light)} | ${cell(t.dark??t.light)} |`).join('\n')}\n\n| Role | Family | Size / line height | Use |\n|---|---|---|---|\n${s.type_roles.map(r=>`| \`t-${r.name}\` | ${cell(r.family)} | ${cell(r.size)} / ${cell(r.lh)} | ${cell(r.usage)} |`).join('\n')}\n\n## Compose and verify\n\nUse this system’s colors and type roles consistently. Make one clear visual argument from the actual subject. Keep text measures readable, controls labeled and numeric figures aligned. Stack or simplify dense layouts at 390px; respect reduced motion. Preserve the chosen system and stable node identities during later edits.\n\nRead [native design-system selection](html-design-systems.md) for the catalogue and binding limits.\n`;
}
function nativeCatalogueMd(){
 return `---\nname: html-design-systems\ndescription: Select and bind one retained design system to ordinary HTML with generated CSS assets.\n---\n## Read first\n\nChoose one system for the subject and the content’s shape. Read only its native guide. The same specifications generate these assets and the original runtime; do not copy legacy JSX/Helmet recipes into HTML.\n\n| Native guide | Mood | Fits |\n|---|---|---|\n${ROSTER.map(slug=>{const s=loadSpec(slug);return `| [${s.name}](html-system-${slug}.md) | ${cell(s.mood)} | ${cell(s.jobs)} |`;}).join('\n')}\n\n## Binding\n\nDownload the author skill ZIP to obtain the generated \`design-systems/NAME.css\` assets. Inline the chosen file in a \`<style data-af="design-system">\` block and set \`data-af-design-system="NAME"\` plus \`data-af-dark="false"\` or \`"true"\` on \`<html>\`. This is ordinary source CSS, not a claimed runtime stylesheet URL. Read the native guide for exact tokens and classes.\n\nThe stylesheet carries light/dark variables, font faces and typography. Use semantic HTML, ordinary \`class\` and authored CSS for responsive composition. The original kit components, Tailwind utility compilation and page-type recipes are not part of the native HTML contract. Preserve the system’s color/type choices; adapt its composition to the actual task.\n\n## Design judgment\n\nStart with the reader’s decision and the subject’s own visual material. Give the opening a concrete point, choose one expressive moment and let typography establish hierarchy. Do not turn every paragraph into an identical card. Use real data in charts, label assumptions and make comparisons legible. Keep prose under about 80 characters per line and controls usable by keyboard.\n\nVerify desktop, 390px, long values, missing data, font fallback and both chosen color modes. Reuse the same system when editing an existing page unless asked to redesign it. The [installed examples](html-examples.md) show report, chart and shared-app compositions using these generated assets.\n`;
}
export function writeNativeSkill(slugs=ROSTER){
 const entries=[['references/html-design-systems.md',nativeCatalogueMd()],...slugs.flatMap(slug=>[[`references/html-system-${slug}.md`,nativeSystemMd(slug)],[`design-systems/${slug}.css`,nativeSystemCss(slug)]])];
 // Refresh only the generated style block; the example's HTML/behavior remains author-owned.
 for(const [name,slug] of [['report','dossier'],['csv-dashboard','phosphor'],['shared-app','almanac']]){
  const file=path.join(ROOT,`examples/${name}.html`);if(!existsSync(file))continue;
  const source=readFileSync(file,'utf8'),css=nativeSystemCss(slug);
  const updated=source.replace(/<style data-af="design-system">[\s\S]*?<\/style>/,()=>`<style data-af="design-system">${css}</style>`);
  if(updated!==source)writeFileSync(file,updated);
 }
 return entries.map(([relative,text])=>{const file=path.join(ROOT,relative);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,text);return {path:file,bytes:Buffer.byteLength(text)};});
}
