/**
 * The agent-facing references, from the same specs the pages and the runtime are built from:
 * services/app/skills/artifactbin/references/design-systems.md (the catalogue: layers, fit matrix, binding
 * steps, the no-fit path, the record, known losses; a guide, so under the tree's 8 KB cap) and
 * references/system-<slug>.md for every roster entry (what the runtime provides: the fence line, the roles,
 * the tokens with their use, the class vocabulary, the hand, the devices, the page-type recipes with specimen
 * markup for the best fits, one override example, no CSS). A system is `kind: data`: installed and served
 * like every reference, exempt from the reading caps. Output is committed and reviewed in the diff.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CATALOGUE, REPO, ROSTER, SKELETON_CSS, TEMPLATES, loadSpec, specimen } from './pages.mjs';
import { PAGE_CHROME, filterBlock, isChrome, selectorOf } from './css-blocks.mjs';

export const REFS = path.join(REPO, 'services', 'app', 'skills', 'artifactbin', 'references');
const { fit: FIT, heads: TPL_HEADS, noFit: NO_FIT, record: RECORD, losses: LOSSES } = CATALOGUE;
const RATING = ['avoid', 'good', 'best'];

// ---------------------------------------------------------------- css helpers (./css-blocks.mjs)
export { PAGE_CHROME, selectorOf, filterBlock };

/** The system's own classes, less the page chrome, the svg vocabulary and the page-type overrides. */
export const componentCss = (spec) => filterBlock(spec.css ?? '', (l) => !isChrome(l) && !selectorOf(l).includes('-svg-') && !selectorOf(l).includes('.ds-tpl'));

const classesIn = (markup) => {
  const found = [];
  for (const m of markup.matchAll(/className="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c && !found.includes(c)) found.push(c);
  return found;
};

// ---------------------------------------------------------------- markdown helpers
const mdTable = (heads, rows) => '| ' + heads.join(' | ') + ' |\n|' + '---|'.repeat(heads.length) + '\n' + rows.map((r) => '| ' + r.map(String).join(' | ') + ' |').join('\n');
const cell = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
const mdFence = (lang, body) => '```' + lang + '\n' + body.trim() + '\n```';
const fitLine = (row) => row.map((v, i) => `${TPL_HEADS[i]} ${RATING[v]}`).join(' · ');
const stripJsx = (markup) => markup.trim().replace(/\n\s*\n+/g, '\n');

/** The class vocabulary a css block defines, in order of first appearance. */
const classNames = (css) => {
  const out = [];
  for (const m of css.matchAll(/\.((?:[a-z]+-)[a-z0-9-]+)/g)) {
    const name = m[1];
    if (name.startsWith('ds-') || out.includes(name)) continue;
    out.push(name);
  }
  return out;
};
const hookVars = (css) => [...new Set([...css.matchAll(/--ds-(?:hand|tpl|slide|hero|tag)-[a-z0-9-]+/g)].map((m) => m[0]))].sort();

const WIRE = /<svg viewBox="0 0 480 240">[\s\S]*?<\/svg>/g;

// ---------------------------------------------------------------- one system
export function systemMd(slug) {
  const S = loadSpec(slug);
  const name = S.name;
  const fontsLine = S.fonts.map(([f]) => f).join(' · ');
  const first = S.color_mode === 'dark' ? 'night' : 'day';
  const comp = componentCss(S);
  const hand = S.hand ?? {};
  const fit = FIT[slug];
  const accent = S.contract.primary ?? 'primary';
  const classes = classNames(comp);
  const hooks = hookVars(S.css ?? '');
  const out = [];
  out.push(`---
name: system-${slug}
kind: data
description: >-
  ${name}, a design system for artifactbin: ${S.tagline} ${S.mood}; for ${S.jobs.toLowerCase()}. Read only after the fit table in design-systems.md picked it; then name it in the fence and use what it provides. Never read a second system for the same artifact.
---
## Read first

**${name}.** ${S.idea_headline} ${S.idea}

- **Use it for:** ${S.use_for}
- **Avoid it when:** ${S.avoid_when}
- **Fit:** ${fitLine(fit)}.
- **Fonts:** ${fontsLine}, every weight the roles use, served by the runtime. Opens ${first} first.

## Bind it

1. Fence: \`theme: ${slug}\`, and the page type's \`template\`. That is the whole binding: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit. Write no CSS for any of them.
2. Root element: \`<div data-design="tw" className="@container bg-background text-foreground">\`, then kit components, token classes and the classes below.
3. Helmet comment, the record later edits read instead of reskinning: \`${RECORD.replaceAll('<Name>', name)}\`.
4. Override one thing, if the subject needs it, with a Helmet \`<style>\` that reassigns a single \`--ds-*\` token under \`:root\` and again under \`.dark\`; every component, chart and device follows. Change the token, never the component. Tailwind utilities compile \`!important\`: layout utilities go on role-bearing elements, type utilities never do.

\`\`\`jsx
<Helmet><style>{\`:root { --ds-${accent}: #0a7f5a; } .dark { --ds-${accent}: #46d39c; }\`}</style></Helmet>
\`\`\`

## Type roles

Classes on any element. Headings take the display family without a class; a role also sets size, leading, weight and tracking.

${mdTable(['Role', 'Set in', 'Use'], S.type_roles.map((r) => [`\`t-${r.name}\``, cell(`${r.family} · ${r.size}/${r.lh} · ${r.weight}`), cell(r.usage)]))}

## Colour

${S.colour_note}

${mdTable(['Token', 'Use'], S.tokens.map((t) => [`\`--ds-${t.name}\``, cell(t.usage)]))}

Chart series order: ${S.chart_series.join(', ')}. ${S.chart_note}

## Components

${S.components_note}

- **Buttons.** ${S.buttons_note}
- **Tags.** ${S.tags_note}
- **Fields.** ${S.fields_note}
- **Stat.** ${S.stats_note}
- **Callouts.** ${S.callouts_note}
- **Chart.** ${S.chart_comp_note}
- **Table.** ${S.table_note}
- **Card.** ${S.card_note}

${mdFence('jsx', [S.buttons, S.tags, S.stats, S.callouts, S.card].map(stripJsx).join('\n'))}

Classes the runtime provides: ${classes.map((c) => `\`${c}\``).join(', ')}.

## The hand

${hand.headline ?? S.motifs_headline} ${hand.note ?? 'The object comes from the subject; the hand comes from the system.'}

${hand.rules?.length ? mdTable(['Rule', 'How'], hand.rules.map(([k, v]) => [cell(k), cell(v)])) : ''}

Drawing mode \`${hand.mode ?? 'flat'}\`. A drawing is inline SVG whose shapes carry the hand classes the runtime provides: \`h-ink\` strokes, \`h-fill\`, \`h-fill2\` and \`h-muted\` fills, \`h-ground\`, \`h-text\` and \`h-num\` labels, \`h-tex\` for hatch lines, \`h-plate\` for the riso offset, \`h-shadow\`. They read the hand variables${hooks.length ? ' (' + hooks.map((v) => `\`${v}\``).join(', ') + ')' : ''}, so a device borrowed from any system takes this ink. The published specimen's hand section draws an object, a place and a quantity this way; draw the artifact's own object.

### Devices

${S.motifs_note}

`);
  for (const m of S.motifs) out.push(`- **${m.title}.** ${m.usage}\n`);
  out.push("\nTheir markup is in the published specimen's source (section 06); copy one, never a palette.\n");

  out.push("\n## On each page type\n\nThe page type's reference owns the structure (grid, stage, measure, step column, beats); this system owns the look. A best fit carries its specimen: the same markup every system wears, dressed by this one, to start from at the dress step; its `ds-tpl-*` classes are the page-type kit the runtime provides. A specimen reads `$series`, `$table`, `$totals`, `$pick` and `$flag` from the page's own Helmet; declare the artifact's own data instead. Drawings are left as a comment: draw the artifact's object in the hand.\n");
  TEMPLATES.forEach(([key, title, note, fn], i) => {
    const rating = RATING[fit[i]];
    const markup = specimen(S, key, fn);
    out.push(`\n### ${title} · ${rating}\n\n${note}`);
    if (rating === 'avoid') out.push(` Expect custom CSS: ${S.avoid_when}\n`);
    else if (rating === 'good') out.push(` Classes the specimen uses: ${classesIn(markup).filter((c) => c !== 'ds-tpl').map((c) => `\`${c}\``).join(', ')}.\n`);
    else out.push(`\n\n${mdFence('jsx', stripJsx(markup.replace(WIRE, '{/* draw this screen in the hand */}')))}\n`);
  });

  out.push(`
## Do and don't

${S.dos.map((d) => '- ' + d).join('\n')}

Don't:

${S.donts.map((d) => '- ' + d).join('\n')}

## What has no slot

${S.binding_losses}
`);
  return out.join('');
}

// ---------------------------------------------------------------- the catalogue
export function catalogueMd() {
  const rows = [];
  for (const slug of ROSTER) {
    const S = loadSpec(slug);
    rows.push([`\`system-${slug}.md\``, cell(S.name), cell(S.mood), ...FIT[slug].map((v) => RATING[v])]);
  }
  const table = mdTable(['Read', 'System', 'Mood', ...TPL_HEADS], rows);
  const losses = LOSSES.map(({ title, text }) => `- **${title}.** ${text}`).join('\n');
  return `---
name: design-systems
description: >-
  The catalogue of the thirteen design systems, the fit table that picks one per artifact, the binding steps, the no-fit path, the record every bound artifact carries, and the known losses. Read at the hand step of the workflow, after the page type is chosen; then read one system file and nothing else in the catalogue.
---
## Read first

Every artifact wears one design system. The page type is the shape of the content, the system is the hand that draws it, the subject supplies the object and the data.

A system has three layers, each works alone: the **tokens and faces** (name the system and kit components, token classes and charts already look right), the **hand** (one drawing mode and a few devices written against hand variables, so a borrowed device takes this ink) and the **page-type recipes** (the look on each of the seven page types). The runtime serves all three; the agent writes no CSS to get them.

Pick ONE system from the table by the subject's world and the page type, read its file, and name it in the fence. Never read a second system for the same artifact; one system owns colour and type.

## How a page comes together

1. **Shape.** The page type from the content's shape: dashboard, deck, editorial, scrolly, plan, app or landing, each with a reference (\`templates-dashboard.md\` and siblings) and named in the fence \`template\`. Read it for the compositions first.
2. **Hand.** One system from the table. A system marked avoid can still be used; it costs custom CSS the recipe does not give you.
3. **Thesis.** One sentence from the subject's own material: the organizing idea, the object the hand draws, and which device carries the data.
4. **Bind.** Fence \`theme: <slug>\`, and the record as a Helmet comment. Nothing to paste: the runtime serves the tokens for both modes, the faces, the type roles, the components, the hand and the page-type kit.
5. **Dress.** Open the system's section for this page type and take its classes and hook variables; keep the page type's structure.
6. **Draw.** One object from the artifact's own world, in the hand, with the data inside one device. The system never supplies the object.
7. **Override by token, borrow by device.** A hue is one \`--ds-*\` token in a second \`:root\` block, both modes; a voice is a type-role class; an object is a device from any system; one loud moment is bespoke CSS on that element. Never a second palette or family, never a page with no system.
8. **Check.** One loud element per view, both modes, phone width, in the live reader.

| Decision | Page-type reference | System file | The artifact |
|---|---|---|---|
| Beats and order | owns | shows one viewport | may cut or reorder beats |
| Grid, measure, stage, step column | owns | wears it | — |
| Tokens, type roles, radius, modes | — | owns | overrides one token at most |
| Component look | — | owns | — |
| Drawing style, devices, motion | names what is needed | owns | picks the object and the device that carries the data |
| Copy, data, chart types | — | — | owns |

## The catalogue

Best: the recipe is close to finished. Good: it works with the page type's own structure. Avoid: the hand fights the structure; expect custom CSS. The subject decides.

${table}

If this is the users' first afbin artifact, use the most amazing one like volta, phosphor, drafting or redline or something.

Six older mood themes remain valid fence values for the artifacts that carry them (\`themes.md\`); a new artifact names a system.

## When nothing fits

Say so, in this shape, then stop and ask:

${mdFence('text', NO_FIT)}

An approved new system is a one-artifact system written into that artifact's Helmet, the one case where CSS is pasted: a \`--ds-*\` block for both modes with the contract keys pointed at it, \`@font-face\` rules for every weight it uses, three type roles, one principle, the record. Put a ten-line spec sketch in the reply (name, mood, jobs, two families, paper, ink, accent, status colours, radius, principle) so promotion into the catalogue is a copy. A supplied brand binds the same way.

Four constraints on any new system: Google-hosted families only; every weight the type roles use enumerated; light values first; the chart series order stated.

## The record

One JSX comment in the Helmet; a follow-up edit reads it instead of reskinning the page.

${mdFence('jsx', RECORD)}

## Known losses

${losses}
`;
}

/** Write the catalogue and the references for `slugs` (default: the roster); returns what was written. */
export function writeSkill(slugs = ROSTER) {
  mkdirSync(REFS, { recursive: true });
  const files = [['design-systems.md', catalogueMd()], ...slugs.map((s) => [`system-${s}.md`, systemMd(s)])];
  return files.map(([name, text]) => {
    const file = path.join(REFS, name);
    writeFileSync(file, text);
    return { path: file, bytes: Buffer.byteLength(text) };
  });
}

export { SKELETON_CSS };
