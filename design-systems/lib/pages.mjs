/**
 * The specimen page of a design system, from its spec: cover · 00 idea · 01 principles · 02 colour · 03 type ·
 * 04 space, edges, depth, motion · 05 components · 06 the hand · 07 on each page type · 08 in use · 09 rules ·
 * 10 binding. `node scripts/design-systems.mjs pages` writes tmp/design-systems/<slug>.jsx (DS_PAGES_DIR
 * overrides), keeping an existing page's fence identity. The pages are publishing copies, not tracked by git:
 * the specs are the source of truth, and runtime.mjs and skill.mjs read the same specs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { esc, pyJson, pad2 } from './py.mjs';
import { fontFaceCss } from './fonts.mjs';
import { handPanels, render as handRender, phone as handPhone, units as handUnits, screen as handScreen, screenMobile as handScreenMobile } from './hand.mjs';

export const REPO = path.resolve(import.meta.dirname, '../..');
export const CATALOGUE = JSON.parse(readFileSync(path.join(import.meta.dirname, '../catalogue.json'), 'utf8'));
export const ROSTER = CATALOGUE.roster;
export const PAGES_DIR = process.env.DS_PAGES_DIR || path.join(REPO, 'tmp', 'design-systems');
export const CONTRACT_KEYS = ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'border', 'input', 'ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];
export const STATUS = ['positive', 'positive-soft', 'caution', 'caution-soft', 'negative', 'negative-soft'];

/** One spec, as frozen under design-systems/specs. */
export function loadSpec(slug) {
  return JSON.parse(readFileSync(path.join(import.meta.dirname, '../specs', `${slug}.json`), 'utf8'));
}

/** The YAML fence: an existing page keeps its identity lines; the base fields are rewritten from the spec. */
export function fence(spec, existing) {
  // No theme: an authored system carries its own ground, type and structural rules (the M0 probes, 3 Oct 2026),
  // and a mood theme would leak its structural CSS underneath.
  const base = { title: `${spec.name} — design system`, theme: null, template: null, colorMode: spec.color_mode ?? 'light', visibility: 'unlisted', description: spec.tagline };
  const keep = {};
  if (existing) {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(existing);
    if (m) for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      const k = i < 0 ? line : line.slice(0, i), v = i < 0 ? '' : line.slice(i + 1);
      keep[k.trim()] = v.trim();
    }
  }
  const out = { ...keep };
  for (const [k, v] of Object.entries(base)) out[k] = v;
  const lines = Object.entries(out).map(([k, v]) => (k === 'title' || k === 'description') ? `${k}: ${pyJson(v)}` : v === null ? `${k}: null` : `${k}: ${v}`);
  return '---\n' + lines.join('\n') + '\n---\n';
}

export function tokenCss(spec, mode) {
  const names = new Set(spec.tokens.map((t) => t.name));
  const lines = [];
  for (const tk of spec.tokens) lines.push(`  --ds-${tk.name}: ${mode in tk ? tk[mode] : tk.light};`);
  const alias = spec.status_alias ?? {};
  for (const s of STATUS) if (!names.has(s) && s in alias) lines.push(`  --ds-${s}: var(--ds-${alias[s]});`);
  for (const [k, src] of Object.entries(spec.contract)) lines.push(`  --${k}: var(--ds-${src});`);
  if (mode === 'light') {
    lines.push(`  --radius: ${spec.radius_contract};`);
    const fam = spec.families;
    lines.push(`  --font-display: ${fam.display};`);
    lines.push(`  --font-body: ${fam.sans};`);
    lines.push(`  --font-mono: ${fam.mono};`);
  }
  for (const [k, v] of Object.entries(spec.extra_vars ?? {})) {
    const val = v && typeof v === 'object' ? v[mode] : v;
    if (val !== null && val !== undefined) lines.push(`  --ds-${k}: ${val};`);
  }
  return lines.join('\n');
}

export function typeCss(spec) {
  const fam = spec.families;
  return spec.type_roles.map((r) => {
    const props = [`font-family: ${fam[r.family]}`, `font-size: ${r.size}`, `line-height: ${r.lh}`, `font-weight: ${r.weight}`];
    if (r.ls) props.push(`letter-spacing: ${r.ls}`);
    if (r.tt) props.push(`text-transform: ${r.tt}`);
    if (r.fs) props.push(`font-style: ${r.fs}`);
    if (r.extra) props.push(r.extra);
    return `.ds-${spec.slug} .t-${r.name} { ${props.join('; ')}; }`;
  }).join('\n');
}

const swatch = (tk) => {
  const dark = tk.dark ?? tk.light;
  return `<div className="ds-swatch">
  <div className="ds-swatch-chip" data-token="${tk.name}"></div>
  <div className="ds-swatch-meta"><span className="t-label">${esc(tk.name)}</span><span className="ds-hex"><code>${tk.light}</code>${dark === tk.light ? '' : ` · <code>${dark}</code>`}</span></div>
  <p className="ds-swatch-usage">${esc(tk.usage)}</p>
</div>`;
};

const swatchCss = (spec) => spec.tokens.map((tk) => `.ds-${spec.slug} .ds-swatch-chip[data-token="${tk.name}"] { background: var(--ds-${tk.name}); }`).join('\n');

const typeRows = (spec) => spec.type_roles.map((r) => {
  const specLine = `${r.family} · ${r.size}/${r.lh} · ${r.weight}` + (r.ls ? ` · ${r.ls}` : '');
  return `<div className="ds-type-row">
  <div className="ds-type-sample t-${r.name}">${esc(r.sample)}</div>
  <div className="ds-type-meta"><span className="t-label">${r.name}</span><span className="ds-type-spec">${esc(specLine)}</span><span className="ds-type-usage">${esc(r.usage)}</span></div>
</div>`;
}).join('\n');

const kvRows = (items) => items.map(([k, v]) => `<div className="ds-kv"><span className="t-label ds-kv-k">${esc(k)}</span><span className="ds-kv-v">${esc(v)}</span></div>`).join('\n');

const btn = (spec, label, kind = 'primary') => {
  const cls = spec[kind === 'primary' ? 'btn_primary' : 'btn_secondary'];
  if (cls) return `<button className="${cls}">${esc(label)}</button>`;
  return `<Button${kind === 'primary' ? '' : ' variant="outline"'}>${esc(label)}</Button>`;
};

const number = (col, prefix = '', suffix = '', fmt = null, data = '$totals') => {
  let a = `data="${data}" col="${col}"`;
  if (prefix) a += ` prefix="${esc(prefix)}"`;
  if (suffix) a += ` suffix="${esc(suffix)}"`;
  if (fmt) a += ` format="${fmt}"`;
  return `<Number ${a} />`;
};

// ---------- 07 · on each page type: generic specimens -------------------------------------------------------------
function tplDashboard(S, D, T) {
  const kpis = T.kpis.map(([l, c, p, s, f, d]) => `<div className="ds-tpl-kpi"><span className="t-label">${esc(l)}</span><span className="t-numeral">${number(c, p, s, f)}</span><span className="ds-tpl-delta">${esc(d)}</span></div>`).join('');
  const cols = pyJson(D.table_columns);
  const chart = pyJson(T.dash_chart ?? D.chart);
  return `<div className="ds-tpl ds-tpl-dash">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">${esc(T.brand)}</span><span className="t-label ds-tpl-crumb">${esc(T.dash_title)}</span><div className="ds-tpl-bar-end"><Segmented label="Window" value="$pick" options={${pyJson(D.segments)}} /></div></div>
  <div className="ds-tpl-kpis">${kpis}</div>
  <div className="ds-tpl-dash-grid">
    <div className="ds-tpl-tile"><span className="t-label">${esc(D.chart_title)}</span><Question data="$series" height="240px" viz={${chart}} /></div>
    <div className="ds-tpl-tile"><span className="t-label">${esc(T.dash_table_title ?? 'Breakdown')}</span><DataTable data="$table" rowKey="${D.row_key}" height="240px" columns={${cols}} /></div>
  </div>
</div>`;
}

function tplSlides(S, D, T) {
  return `<div className="ds-tpl ds-tpl-slides">
  <div className="ds-tpl-stage ds-tpl-stage-title">
    <div className="ds-tpl-stage-top"><span>${esc(T.brand)}</span><span>${esc(T.slide_eyebrow ?? 'Review')}</span></div>
    <h3 className="ds-tpl-slide-h">${esc(T.slide_title)}</h3>
    <p className="ds-tpl-slide-sub">${esc(T.slide_sub)}</p>
    <div className="ds-tpl-stage-foot"><span>01 / 06</span><span>${esc(T.slide_foot ?? 'Synthetic data')}</span></div>
  </div>
  <div className="ds-tpl-stage ds-tpl-stage-stat">
    <div className="ds-tpl-stage-top"><span>${esc(T.brand)}</span><span>02 · ${esc(T.slide_stat_label)}</span></div>
    <div className="ds-tpl-slide-big">${number(T.slide_stat_col, T.slide_stat_prefix ?? '', T.slide_stat_suffix ?? '', T.slide_stat_fmt ?? null)}</div>
    <p className="ds-tpl-slide-cap">${esc(T.slide_body)}</p>
    <div className="ds-tpl-split"><span className="ds-tpl-split-a">${esc(T.split[0])}</span><span className="ds-tpl-split-b">${esc(T.split[1])}</span></div>
    <div className="ds-tpl-stage-foot"><span>02 / 06</span><span>${esc(T.slide_foot ?? 'Synthetic data')}</span></div>
  </div>
</div>`;
}

function tplEditorial(S, D, T) {
  const body = T.ed_body;
  return `<div className="ds-tpl ds-tpl-ed">
  <p className="t-label ds-tpl-kicker">${esc(T.ed_kicker)}</p>
  <h3 className="t-display-l ds-tpl-ed-h">${esc(T.ed_headline)}</h3>
  <p className="ds-tpl-deck">${esc(T.ed_deck)}</p>
  <p className="t-label ds-tpl-byline">${esc(T.ed_byline)}</p>
  <div className="ds-tpl-ed-cols">
    <p className="ds-tpl-ed-body"><span className="ds-tpl-dropcap">${esc(body[0])}</span>${esc(body.slice(1))}</p>
    <div className="ds-tpl-pull"><span className="t-numeral ds-tpl-pull-n">${number(T.ed_pull_col, T.ed_pull_prefix ?? '', T.ed_pull_suffix ?? '', T.ed_pull_fmt ?? null)}</span><span className="t-label">${esc(T.ed_pull_label)}</span></div>
  </div>
</div>`;
}

function tplScrolly(S, D, T) {
  const steps = T.steps.map(([h, p], i) => `<div className="ds-tpl-step"><span className="t-label">${pad2(i + 1)}</span><h4 className="t-title">${esc(h)}</h4><p>${esc(p)}</p></div>`).join('');
  const fig = handRender(S, 'units', handUnits);
  return `<div className="ds-tpl ds-tpl-scrolly">
  <div className="ds-tpl-steps">${steps}</div>
  <div className="ds-tpl-figure"><div className="ds-tpl-figure-art">${fig}</div><p className="t-label ds-tpl-figure-cap">${esc(T.step_caption)}</p></div>
</div>`;
}

function tplApp(S, D, T) {
  const rows = T.app_rows.map(([n, m, s, k]) => `<div className="ds-tpl-row"><span className="ds-tpl-row-name">${esc(n)}</span><span className="ds-tpl-row-meta">${esc(m)}</span><span className="ds-tpl-tag is-${k}">${esc(s)}</span></div>`).join('');
  return `<div className="ds-tpl ds-tpl-app">
  <div className="ds-tpl-bar"><span className="ds-tpl-brand">${esc(T.brand)}</span><div className="ds-tpl-bar-end"><Input label="Search" placeholder="${esc(D.input_placeholder)}" value="$pick" />${btn(S, T.app_cta)}</div></div>
  <div className="ds-tpl-rows">${rows}</div>
  <div className="ds-tpl-form"><Select label="${esc(D.select_label)}" value="$pick" options={${pyJson(D.segments)}} /><Switch label="${esc(D.switch_label)}" checked="$flag" />${btn(S, T.app_cta2 ?? 'Save', 'secondary')}</div>
</div>`;
}

function tplLanding(S, D, T) {
  const feats = T.features.map(([h, p]) => `<div className="ds-tpl-feat"><h4 className="t-title">${esc(h)}</h4><p>${esc(p)}</p></div>`).join('');
  const fig = handRender(S, 'phone', handPhone);
  return `<div className="ds-tpl ds-tpl-landing">
  <div className="ds-tpl-hero">
    <div className="ds-tpl-hero-words"><p className="t-label ds-tpl-kicker">${esc(T.landing_eyebrow)}</p><h3 className="t-display-xl ds-tpl-hero-h">${esc(T.landing_headline)}</h3><p className="ds-tpl-hero-sub">${esc(T.landing_sub)}</p><div className="ds-row">${btn(S, T.cta)}${btn(S, T.cta2, 'secondary')}</div></div>
    <div className="ds-tpl-hero-art">${fig}</div>
  </div>
  <div className="ds-tpl-feats">${feats}</div>
</div>`;
}

const PLAN_DEFAULT = {
  plan_eyebrow: 'UI plan · Review draft', plan_title: 'Onboarding: from sign-in to first value',
  plan_outcome: 'A new workspace reaches its first real result in under ten minutes, on desktop and phone, without a support call.',
  plan_scope: 'Sign-in, workspace setup, first import, first result. Out: billing, invites, SSO.',
  plan_status: 'Plan only · 2 of 6 tasks done · nothing verified in production',
  plan_screens_note: 'S1 desktop keeps the rail and the stat row beside the chart; S1 mobile stacks the stat above the rows and moves the primary action to the bottom.',
  plan_flow: `flowchart LR
  A((Sign in)) -->|Continue| B[S1 Overview]
  B -->|Import| C{Rows parse?}
  C -->|Yes| D[S2 First result]
  C -->|No| E[S2e Fix columns]
  E -->|Retry| C
  D -->|Share| F((Done))`,
  plan_flow_title: 'Screen transitions',
  plan_decisions: [['Import before invite.', 'A first result alone beats an empty workspace with teammates in it. Invites move to S3.'], ['One primary action per screen.', 'Continue, Import, Share. Everything else is a link.'], ['Errors keep the data.', 'A failed parse shows the columns it could not read and keeps the file; the user never re-uploads.']],
  plan_tasks: [['Wireframes S1–S2 reviewed', 'Design', 'Done', true], ['Import parser handles quoted commas', 'Platform', 'Done', true], ['S2e fix-columns screen', 'App', 'In progress', false], ['Mobile bottom action bar', 'App', 'Pending', false], ['First-result empty state copy', 'Content', 'Pending', false], ['Verify on a 390px viewport', 'QA', 'Pending', false]],
  plan_acceptance: 'Done means: a fresh account reaches S2 with real data in under ten minutes on a phone, and the S2e branch recovers without a re-upload.',
};

function tplPlan(S, D, T) {
  const P = { ...PLAN_DEFAULT, ...Object.fromEntries(Object.entries(T).filter(([k]) => k.startsWith('plan_'))) };
  const desk = handRender(S, 'screen', handScreen), mob = handRender(S, 'screen-mobile', handScreenMobile);
  const decisions = P.plan_decisions.map(([h, b]) => `<div className="ds-tpl-decision"><h4 className="t-title">${esc(h)}</h4><p>${esc(b)}</p></div>`).join('');
  const kind = { Done: 'ok', 'In progress': 'warn', Pending: 'idle', Blocked: 'bad' };
  const rows = P.plan_tasks.map(([t, o, st, done]) => `<tr><td>${done ? '<s>' + esc(t) + '</s>' : esc(t)}</td><td>${esc(o)}</td><td><span className="ds-tpl-tag is-${kind[st] ?? 'idle'}">${esc(st)}</span></td></tr>`).join('');
  return `<div className="ds-tpl ds-tpl-plan">
  <div className="ds-tpl-plan-head"><p className="t-label ds-tpl-kicker">${esc(P.plan_eyebrow)}</p><h3 className="t-display-m ds-tpl-plan-h">${esc(P.plan_title)}</h3>
    <div className="ds-tpl-plan-brief"><div><span className="t-label">Outcome</span><p>${esc(P.plan_outcome)}</p></div><div><span className="t-label">Scope</span><p>${esc(P.plan_scope)}</p></div><div><span className="t-label">Status</span><p>${esc(P.plan_status)}</p></div></div></div>
  <p className="t-label ds-tpl-plan-sub">01 · Proposed screens</p>
  <div className="ds-tpl-wires"><div className="ds-tpl-wire ds-tpl-wire-desk">${desk}</div><div className="ds-tpl-wire">${mob}</div></div>
  <p className="ds-tpl-wire-cap">${esc(P.plan_screens_note)}</p>
  <p className="t-label ds-tpl-plan-sub">02 · Transitions</p>
  <div className="ds-tpl-flow"><Mermaid title="${esc(P.plan_flow_title)}" code={\`${P.plan_flow}\`} /></div>
  <p className="t-label ds-tpl-plan-sub">03 · Decisions</p>
  <div className="ds-tpl-decisions">${decisions}</div>
  <p className="t-label ds-tpl-plan-sub">04 · Execution ledger</p>
  <table className="ds-tpl-ledger"><thead><tr><th>Task</th><th>Owner</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
  <p className="ds-tpl-wire-cap">${esc(P.plan_acceptance)}</p>
</div>`;
}

export const TEMPLATES = [
  ['dashboard', 'Dashboard', 'Template: dashboard. The template owns the 12-column grid, 24px gutters and tile stacking; the system owns the tile edge, the numeral and the chart colours.', tplDashboard],
  ['slides', 'Deck', 'Template: deck. The template owns the 16:9 stage, the acts and the slide count; the system owns the type scale on the stage, the one big number and the footer rule.', tplSlides],
  ['editorial', 'Editorial', 'Template: editorial. The template owns the measure, the folio rhythm and figure placement; the system owns the kicker, the headline face, the deck and the pull figure.', tplEditorial],
  ['scrolly', 'Scrolly', 'Template: scrolly. The template owns the conceit, the step column and the sticky figure (sticky is set by the live reader); the system owns the step card and the figure, drawn in its hand.', tplScrolly],
  ['plan', 'Plan', 'Template: plan. The template owns the beats (brief, screens, transitions, decisions, ledger) and the Mermaid component; the system owns the wireframe hand, the status tags, the ledger rule and the one accent that connects screen IDs and arrows.', tplPlan],
  ['app', 'App', 'Page type: app, published without a template field. The system owns the toolbar, the row rhythm, the status tags and the primary button; the structure comes from the subject.', tplApp],
  ['landing', 'Landing', 'Page type: landing, published without a template field. The system owns the headline, the device drawing and the pair of buttons; the hero split and feature row are the usual shape.', tplLanding],
];

/** One page type's specimen markup for a spec: the spec's own override, else the generic one. */
export const specimen = (S, key, fn) => (S.templates ?? {})[key] || fn(S, S.data, S.tpl);

const templatesSection = (S) => TEMPLATES.map(([key, title, note, fn]) => `<div className="ds-tpl-block"><div className="ds-tpl-head"><h3 className="t-title">${title}</h3><p>${esc(note)}</p></div>${specimen(S, key, fn)}</div>`).join('\n');

/** The page source for a spec, with `existing` (the current page, if any) supplying the fence identity. */
export function buildPage(spec, existing) {
  const slug = spec.slug;
  const names = new Set(spec.tokens.map((tk) => tk.name));
  const missing = STATUS.filter((s) => !names.has(s) && !(s in (spec.status_alias ?? {})));
  if (missing.length) throw new Error(`${slug}: status tokens missing (add tokens or status_alias): ${missing.join(', ')}`);
  const faces = spec.fonts.map(([f, a]) => fontFaceCss(f, a)).join('\n');
  const css = `${faces}
:root {
${tokenCss(spec, 'light')}
}
.dark {
${tokenCss(spec, 'dark')}
}
${typeCss(spec)}
${swatchCss(spec)}
${SKELETON_CSS.replaceAll('.ds-X', '.ds-' + slug)}
${(spec.css ?? '').trim()}
`;
  const data = spec.data;
  const helmet = `<Helmet>
<title>${esc(spec.name)} — design system</title>
<style>{\`
${css}
\`}</style>
<Value name="rows" type="table" value={${pyJson(data.rows)}} />
${Object.entries(data.queries).map(([q, sql]) => `<Query name="${q}">{\`${sql}\`}</Query>` + '\n').join('')}<Value name="pick" type="string" default=${pyJson(data.segment_default)} />
<Value name="flag" type="boolean" default={true} />
</Helmet>`;
  const S = spec;
  const chips = [S.mood, S.jobs, S.fonts.slice(0, 3).map(([f]) => f).join(' · ')].map((c) => `<span className="ds-chip">${esc(c)}</span>`).join(' ');
  const principles = S.principles.map(([t, b], i) => `<li className="ds-principle"><span className="ds-principle-n t-numeral">${pad2(i + 1)}</span><div><h3 className="t-title">${esc(t)}</h3><p>${esc(b)}</p></div></li>`).join('\n');
  const voice = S.voice.map((v) => `<li>${esc(v)}</li>`).join('\n');
  const groups = new Map();
  for (const tk of S.tokens) { if (!groups.has(tk.group)) groups.set(tk.group, []); groups.get(tk.group).push(tk); }
  const colour = [...groups].map(([g, ts]) => `<div className="ds-swatch-group"><p className="t-label ds-group-label">${esc(g)}</p><div className="ds-swatch-grid">${ts.map(swatch).join('\n')}</div></div>`).join('\n');
  const hand = S.hand ?? {};
  const panels = handPanels(S).map(([title, svg]) => `<div className="ds-hand-panel"><div className="ds-hand-art">${svg}</div><p className="t-label">${esc(title)}</p></div>`).join('\n');
  const motifs = S.motifs.map((m) => `<div className="ds-motif"><div className="ds-motif-art">${m.svg}</div><h3 className="t-title">${esc(m.title)}</h3><p>${esc(m.usage)}</p></div>`).join('\n');
  const dos = S.dos.map((d) => `<li>${esc(d)}</li>`).join('\n'), donts = S.donts.map((d) => `<li>${esc(d)}</li>`).join('\n');
  const mapping = Object.entries(S.contract).map(([k, v]) => `<tr><td><code>--${k}</code></td><td><code>--ds-${v}</code></td></tr>`).join('\n');
  const bindingCss = `:root {\n${tokenCss(S, 'light')}\n}\n.dark {\n${tokenCss(S, 'dark')}\n}`;
  const cols = pyJson(data.table_columns);
  const chart = pyJson(data.chart);
  const motion = S.motion || S.depth;
  const body = `<div data-design="tw" className="@container ds ds-${slug} bg-background text-foreground">
<section className="ds-cover">
  <div className="ds-cover-art" aria-hidden="true">${S.cover_svg}</div>
  <div className="ds-cover-words">
    <p className="t-label ds-eyebrow">Design system · ${esc(S.mood)}</p>
    <h1 className="t-display-xl ds-cover-name">${esc(S.name)}</h1>
    <p className="ds-cover-tag">${esc(S.tagline)}</p>
    <div className="ds-chips">${chips}</div>
  </div>
</section>
<div className="ds-wrap">
<nav className="ds-toc"><span className="t-label">On this page</span>${['00 Idea', '01 Principles', '02 Colour', '03 Type', '04 Space, edges, motion', '05 Components', '06 The hand', '07 On each page type', '08 In use', '09 Rules', '10 Binding'].map((n) => `<span>${n}</span>`).join('')}</nav>
<section className="ds-section">
  <p className="t-label ds-eyebrow">00 · Idea</p>
  <h2 className="t-display-l">${esc(S.idea_headline)}</h2>
  <p className="ds-lede">${esc(S.idea)}</p>
  <div className="ds-two">
    <div><p className="t-label ds-eyebrow">Use it for</p><p>${esc(S.use_for)}</p></div>
    <div><p className="t-label ds-eyebrow">Avoid it when</p><p>${esc(S.avoid_when)}</p></div>
  </div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">01 · Principles</p>
  <h2 className="t-display-l">${esc(S.principles_headline)}</h2>
  <ol className="ds-principles">${principles}</ol>
  <div className="ds-voice"><p className="t-label ds-eyebrow">Voice</p><ul>${voice}</ul></div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">02 · Colour</p>
  <h2 className="t-display-l">${esc(S.colour_headline)}</h2>
  <p className="ds-lede">${esc(S.colour_note)}</p>
  ${colour}
  <div className="ds-note"><p className="t-label ds-eyebrow">Chart series order</p><p>${esc(S.chart_note)}</p><div className="ds-series">${S.chart_series.map((n, i) => `<span className="ds-series-chip" data-series="${i + 1}"><i></i>chart-${i + 1} · ${esc(n)}</span>`).join('')}</div></div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">03 · Type</p>
  <h2 className="t-display-l">${esc(S.type_headline)}</h2>
  <p className="ds-lede">${esc(S.type_note)}</p>
  <div className="ds-type">${typeRows(S)}</div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">04 · Space, edges, depth, motion</p>
  <h2 className="t-display-l">${esc(S.space_headline)}</h2>
  <div className="ds-three">
    <div><p className="t-label ds-eyebrow">Space</p>${kvRows(S.space)}</div>
    <div><p className="t-label ds-eyebrow">Radius, edges, depth</p>${kvRows(S.edges)}${S.motion ? kvRows(S.depth) : ''}</div>
    <div><p className="t-label ds-eyebrow">Motion and interaction</p>${kvRows(motion)}</div>
  </div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">05 · Components</p>
  <h2 className="t-display-l">${esc(S.components_headline)}</h2>
  <p className="ds-lede">${esc(S.components_note)}</p>
  <div className="ds-comp-grid">
    <div className="ds-comp"><p className="t-label ds-eyebrow">Buttons</p><div className="ds-row">${S.buttons}</div><p className="ds-comp-note">${esc(S.buttons_note)}</p></div>
    <div className="ds-comp"><p className="t-label ds-eyebrow">Tags</p><div className="ds-row">${S.tags}</div><p className="ds-comp-note">${esc(S.tags_note)}</p></div>
    <div className="ds-comp"><p className="t-label ds-eyebrow">Fields</p><div className="ds-fields"><Segmented label="Window" value="$pick" options={${pyJson(data.segments)}} /><Select label="${esc(data.select_label)}" value="$pick" options={${pyJson(data.segments)}} /><Input label="Search" placeholder="${esc(data.input_placeholder)}" value="$pick" /><Switch label="${esc(data.switch_label)}" checked="$flag" /></div><p className="ds-comp-note">${esc(S.fields_note)}</p></div>
    <div className="ds-comp"><p className="t-label ds-eyebrow">Stat</p><div className="ds-row ds-stats">${S.stats}</div><p className="ds-comp-note">${esc(S.stats_note)}</p></div>
    <div className="ds-comp"><p className="t-label ds-eyebrow">Callouts</p><div className="ds-callouts">${S.callouts}</div><p className="ds-comp-note">${esc(S.callouts_note)}</p></div>
    <div className="ds-comp"><p className="t-label ds-eyebrow">Tabs and progress</p><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">${esc(data.tabs[0])}</TabsTrigger><TabsTrigger value="b">${esc(data.tabs[1])}</TabsTrigger><TabsTrigger value="c">${esc(data.tabs[2])}</TabsTrigger></TabsList><TabsContent value="a"><p className="ds-comp-note">${esc(data.tab_body)}</p></TabsContent><TabsContent value="b"><p className="ds-comp-note">Second tab.</p></TabsContent><TabsContent value="c"><p className="ds-comp-note">Third tab.</p></TabsContent></Tabs><div className="ds-progress"><span className="t-label">${esc(data.progress_label)}</span><Progress value={${data.progress}} /></div></div>
  </div>
  <div className="ds-comp-wide">
    <div className="ds-comp"><p className="t-label ds-eyebrow">Chart</p><Question title="${esc(data.chart_title)}" data="$series" height="300px" viz={${chart}} /><p className="ds-comp-note">${esc(S.chart_comp_note)}</p></div>
    <div className="ds-comp"><p className="t-label ds-eyebrow">Table</p><DataTable data="$table" rowKey="${data.row_key}" height="${data.table_height ?? '300px'}" columns={${cols}} /><p className="ds-comp-note">${esc(S.table_note)}</p></div>
  </div>
  <div className="ds-comp"><p className="t-label ds-eyebrow">Card</p>${S.card}<p className="ds-comp-note">${esc(S.card_note)}</p></div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">06 · The hand</p>
  <h2 className="t-display-l">${esc(hand.headline ?? S.motifs_headline)}</h2>
  <p className="ds-lede">${esc(hand.note ?? 'The object comes from the subject; the hand comes from the system. Below, three subjects from unrelated worlds drawn the way this system draws everything, so the technique is what you copy, not the picture.')}</p>
  <div className="ds-hand-rules">${kvRows(hand.rules ?? [])}</div>
  <div className="ds-hand">${panels}</div>
  <div className="ds-note ds-borrow"><p className="t-label ds-eyebrow">Mix and match</p><p>Every device on this page is written against the hand variables (<code>--ds-hand-ink</code>, <code>--ds-hand-fill</code>, <code>--ds-hand-fill2</code>, <code>--ds-hand-muted</code>) and the contract keys, never a hex value, so a device from another system drops in and takes this system&#39;s ink. Borrow devices freely. Never borrow a palette or a type pairing: one system per artifact owns colour and type, and the object you draw comes from the artifact&#39;s own subject.</p></div>
  <p className="t-label ds-eyebrow ds-devices-label">Its own devices</p>
  <p className="ds-lede ds-devices-note">${esc(S.motifs_note)}</p>
  <div className="ds-motifs">${motifs}</div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">07 · On each page type</p>
  <h2 className="t-display-l">The template owns the grid. ${esc(S.name)} owns the look.</h2>
  <p className="ds-lede">Seven specimens, one per page type (dashboard, deck, editorial, scrolly, plan, app, landing), built from the same markup for every system and dressed only by these tokens, type roles and classes. Structural rules (the dashboard grid, the slide stage, the scrolly step column, the plan beats) stay with the template reference; what you take from here is how ${esc(S.name)} wears them.</p>
  <div className="ds-tpls">${templatesSection(S)}</div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">08 · In use</p>
  <h2 className="t-display-l">${esc(S.sample_headline)}</h2>
  <p className="ds-lede">${esc(S.sample_note)}</p>
</section>
</div>
<section className="ds-sample">${S.sample}</section>
<div className="ds-wrap">
<section className="ds-section">
  <p className="t-label ds-eyebrow">09 · Rules</p>
  <h2 className="t-display-l">Do and don&#39;t</h2>
  <div className="ds-two"><div><p className="t-label ds-eyebrow">Do</p><ul className="ds-rules">${dos}</ul></div><div><p className="t-label ds-eyebrow">Don&#39;t</p><ul className="ds-rules ds-rules-no">${donts}</ul></div></div>
</section>
<section className="ds-section">
  <p className="t-label ds-eyebrow">10 · Binding</p>
  <h2 className="t-display-l">How an artifact wears ${esc(S.name)}</h2>
  <p className="ds-lede">The system&#39;s own names live as <code>--ds-*</code> custom properties; the artifactbin contract keys point at them, so every kit component, Tailwind token class and chart follows. Copy the block below into a Helmet style, keep the @font-face rules from this page&#39;s source, and record the binding in a Helmet comment.</p>
  <div className="ds-two">
    <table className="ds-map"><thead><tr><th>Contract key</th><th>${esc(S.name)} token</th></tr></thead><tbody>${mapping}</tbody></table>
    <div><p className="t-label ds-eyebrow">No slot in the contract — carried as extra properties</p><p>${esc(S.binding_losses)}</p></div>
  </div>
  <pre className="ds-code"><code>{\`${bindingCss}\`}</code></pre>
  <div className="ds-two"><div><p className="t-label ds-eyebrow">Override one thing</p><p>Add a second <code>:root</code> block after this one and reassign a single <code>--ds-*</code> token, radius or family; every component, chart and device follows. Change the token, not the component.</p></div><div><p className="t-label ds-eyebrow">What is yours to choose</p><p>The subject&#39;s object (what the hand draws), which one device carries the data, the template, and the copy. What stays fixed: the palette, the type pairing, the hand mode, and one loud element per view.</p></div></div>
</section>
<footer className="ds-foot"><span className="t-label">${esc(S.name)} · design system · artifactbin</span><span>${esc(S.footer)}</span></footer>
</div>
</div>`;
  return fence(spec, existing) + helmet + '\n' + body + '\n';
}

/** Write the pages for `slugs` (default: the roster) into PAGES_DIR; returns what was written. */
export function writePages(slugs = ROSTER, dir = PAGES_DIR) {
  mkdirSync(dir, { recursive: true });
  return slugs.map((slug) => {
    const file = path.join(dir, `${slug}.jsx`);
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
    const out = buildPage(loadSpec(slug), existing);
    writeFileSync(file, out);
    return { path: file, bytes: Buffer.byteLength(out) };
  });
}

export const SKELETON_CSS = `
.ds-X { font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
.ds-X .ds-wrap { max-width: 1180px; margin: 0 auto; padding: 0 20px; }
.ds-X .ds-cover { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: end; padding: 32px 20px 40px; background: var(--ds-cover-bg, var(--background)); color: var(--ds-cover-fg, var(--foreground)); }
.ds-X .ds-cover-art { order: -1; width: 100%; aspect-ratio: 480 / 288; pointer-events: none; }
.ds-X .ds-cover-art svg { display: block; width: 100%; height: 100%; }
.ds-X .ds-cover-words { min-width: 0; }
.ds-X .ds-cover-name { margin: 8px 0 0; }
.ds-X .ds-cover-tag { margin: 18px 0 0; font-size: 20px; line-height: 1.35; max-width: 34ch; color: var(--ds-cover-muted, var(--muted-foreground)); }
.ds-X .ds-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
.ds-X .ds-chip { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; padding: 4px 10px; border: 1px solid currentColor; border-radius: var(--ds-chip-radius, 999px); opacity: .85; }
.ds-X .ds-toc { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 20px 0; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--muted-foreground); }
.ds-X .ds-toc .t-label { color: var(--foreground); margin-right: 6px; }
.ds-X .ds-section { padding: 72px 0 8px; border-top: 1px solid var(--border); margin-top: 48px; }
.ds-X .ds-toc + .ds-section { border-top: none; margin-top: 0; padding-top: 56px; }
.ds-X .ds-eyebrow { color: var(--muted-foreground); margin: 0 0 12px; }
.ds-X .ds-section h2 { margin: 0; max-width: 18ch; text-wrap: balance; }
.ds-X .ds-lede { margin: 20px 0 0; font-size: 19px; line-height: 1.5; max-width: 62ch; color: var(--muted-foreground); }
.ds-X .ds-two { display: grid; gap: 32px; margin-top: 36px; }
.ds-X .ds-three { display: grid; gap: 32px; margin-top: 36px; }
.ds-X .ds-two p, .ds-X .ds-three p { margin: 0; line-height: 1.55; }
.ds-X .ds-principles { list-style: none; margin: 40px 0 0; padding: 0; display: grid; gap: 28px; }
.ds-X .ds-principle { display: grid; grid-template-columns: 72px 1fr; gap: 16px; align-items: start; padding-top: 20px; border-top: 1px solid var(--border); }
.ds-X .ds-principle h3 { margin: 0; }
.ds-X .ds-principle p { margin: 8px 0 0; line-height: 1.55; color: var(--muted-foreground); max-width: 60ch; }
.ds-X .ds-principle-n { color: var(--primary); font-size: 32px; line-height: 1; }
.ds-X .ds-voice { margin-top: 40px; padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
.ds-X .ds-voice ul { margin: 0; padding-left: 18px; line-height: 1.6; }
.ds-X .ds-swatch-group { margin-top: 36px; }
.ds-X .ds-group-label { color: var(--muted-foreground); margin: 0 0 12px; }
.ds-X .ds-swatch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
.ds-X .ds-swatch-chip { height: 88px; border: 1px solid var(--border); border-radius: var(--radius); }
.ds-X .ds-swatch-meta { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.ds-X .ds-hex { font-size: 12px; color: var(--muted-foreground); }
.ds-X .ds-hex code { font-size: 11px; }
.ds-X .ds-swatch-usage { margin: 6px 0 0; font-size: 13px; line-height: 1.45; color: var(--muted-foreground); }
.ds-X .ds-note { margin-top: 40px; padding: 24px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
.ds-X .ds-note p { margin: 0; line-height: 1.5; }
.ds-X .ds-series { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.ds-X .ds-series-chip { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.ds-X .ds-series-chip i { display: inline-block; width: 16px; height: 16px; border-radius: 2px; }
.ds-X .ds-series-chip[data-series="1"] i { background: var(--chart-1); } .ds-X .ds-series-chip[data-series="2"] i { background: var(--chart-2); } .ds-X .ds-series-chip[data-series="3"] i { background: var(--chart-3); } .ds-X .ds-series-chip[data-series="4"] i { background: var(--chart-4); } .ds-X .ds-series-chip[data-series="5"] i { background: var(--chart-5); }
.ds-X .ds-type { margin-top: 36px; border-top: 1px solid var(--border); }
.ds-X .ds-type-row { display: grid; gap: 10px; padding: 24px 0; border-bottom: 1px solid var(--border); }
.ds-X .ds-type-sample { margin: 0; overflow-wrap: anywhere; }
.ds-X .ds-type-meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 13px; color: var(--muted-foreground); }
.ds-X .ds-type-meta .t-label { color: var(--foreground); }
.ds-X .ds-kv { display: grid; grid-template-columns: 110px 1fr; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; line-height: 1.45; }
.ds-X .ds-kv-k { color: var(--foreground); padding-top: 2px; }
.ds-X .ds-comp-grid { display: grid; gap: 24px; margin-top: 36px; }
.ds-X .ds-comp-wide { display: grid; gap: 24px; margin-top: 24px; }
.ds-X .ds-comp { padding: 24px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); min-width: 0; }
.ds-X .ds-comp-wide + .ds-comp { margin-top: 24px; }
.ds-X .ds-comp-note { margin: 16px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted-foreground); }
.ds-X .ds-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.ds-X .ds-fields { display: grid; gap: 16px; }
.ds-X .ds-callouts { display: grid; gap: 12px; }
.ds-X .ds-progress { margin-top: 20px; display: grid; gap: 8px; }
.ds-X .ds-hand-rules { display: grid; gap: 0 32px; margin-top: 28px; }
.ds-X .ds-hand { display: grid; gap: 20px; margin-top: 32px; }
.ds-X .ds-hand-panel { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--card); }
.ds-X .ds-hand-art { background: var(--ds-hand-bg, var(--muted)); padding: 12px; }
.ds-X .ds-hand-art svg { display: block; width: 100%; height: auto; }
.ds-X .ds-hand-panel .t-label { display: block; padding: 12px 16px; color: var(--muted-foreground); }
.ds-X .h-ink { stroke: var(--ds-hand-ink, var(--foreground)); fill: none; stroke-width: var(--ds-hand-stroke, 2); stroke-linecap: var(--ds-hand-cap, round); stroke-linejoin: round; }
.ds-X .h-fill { fill: var(--ds-hand-fill, var(--primary)); } .ds-X .h-fill2 { fill: var(--ds-hand-fill2, var(--chart-1)); } .ds-X .h-muted { fill: var(--ds-hand-muted, var(--muted)); }
.ds-X .h-ground { fill: var(--ds-hand-ground, var(--card)); }
.ds-X .h-tex line { stroke: var(--ds-hand-fill, var(--primary)); stroke-width: var(--ds-hand-tex, 2); } .ds-X .h-tex-fill2 line { stroke: var(--ds-hand-fill2, var(--chart-1)); }
.ds-X .h-outline-fill { fill: none; stroke: var(--ds-hand-fill, var(--primary)); stroke-width: var(--ds-hand-stroke, 2); }
.ds-X .h-text { font-family: var(--font-mono); font-size: 11px; letter-spacing: .06em; fill: var(--ds-hand-ink, var(--foreground)); paint-order: stroke; stroke: var(--ds-hand-text-stroke, transparent); stroke-width: 3px; stroke-linejoin: round; }
.ds-X .h-num { font-family: var(--font-display); font-size: 44px; font-weight: 700; letter-spacing: -.02em; fill: var(--ds-hand-ink, var(--foreground)); }
.ds-X .h-glow .h-ink { stroke: var(--ds-hand-fill, var(--primary)); stroke-width: 9; opacity: .32; }
.ds-X .h-plate { mix-blend-mode: multiply; opacity: .9; }
.dark .ds-X .h-plate { mix-blend-mode: normal; }
.ds-X .h-shadow { fill: var(--ds-hand-shadow, var(--foreground)); }
.ds-X .ds-borrow { margin-top: 32px; }
.ds-X .ds-devices-label { margin-top: 48px; }
.ds-X .ds-devices-note { margin-top: 8px; font-size: 16px; }
.ds-X .ds-motifs { display: grid; gap: 24px; margin-top: 24px; }
.ds-X .ds-motif { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--card); }
.ds-X .ds-motif-art { background: var(--muted); padding: 16px; }
.ds-X .ds-motif-art svg { display: block; width: 100%; height: auto; }
.ds-X .ds-motif h3 { margin: 16px 20px 0; }
.ds-X .ds-motif p { margin: 8px 20px 20px; font-size: 14px; line-height: 1.5; color: var(--muted-foreground); }
.ds-X .ds-tpls { display: grid; gap: 40px; margin-top: 40px; }
.ds-X .ds-tpl-block { display: grid; gap: 16px; }
.ds-X .ds-tpl-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 20px; }
.ds-X .ds-tpl-head h3 { margin: 0; } .ds-X .ds-tpl-head p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted-foreground); max-width: 70ch; }
.ds-X .ds-tpl { border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); background: var(--background); padding: 20px; min-width: 0; overflow: hidden; box-shadow: var(--ds-tpl-shadow, none); }
.ds-X .ds-tpl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding-bottom: 14px; border-bottom: var(--ds-tpl-rule, 1px solid var(--border)); }
.ds-X .ds-tpl-brand { font-family: var(--font-display); font-weight: 700; font-size: 20px; letter-spacing: -.01em; }
.ds-X .ds-tpl-crumb { color: var(--muted-foreground); }
.ds-X .ds-tpl-bar-end { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-left: auto; }
.ds-X .ds-tpl-kpis { display: grid; gap: 12px; margin-top: 16px; }
.ds-X .ds-tpl-kpi { display: grid; gap: 4px; padding: 16px 18px; background: var(--card); border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); box-shadow: var(--ds-tpl-tile-shadow, none); }
.ds-X .ds-tpl-delta { font-size: 13px; color: var(--muted-foreground); }
.ds-X .ds-tpl-dash-grid { display: grid; gap: 12px; margin-top: 12px; }
.ds-X .ds-tpl-tile { display: grid; gap: 10px; padding: 16px 18px; overflow-x: auto; background: var(--card); border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); min-width: 0; box-shadow: var(--ds-tpl-tile-shadow, none); }
.ds-X .ds-tpl-slides { display: grid; gap: 16px; padding: 16px; background: var(--muted); }
.ds-X .ds-tpl-stage { container-type: inline-size; aspect-ratio: 16 / 9; position: relative; display: flex; flex-direction: column; padding: 5cqw 6cqw; background: var(--ds-slide-bg, var(--card)); color: var(--ds-slide-fg, var(--card-foreground)); border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); overflow: hidden; min-width: 0; }
.ds-X .ds-tpl-stage-title { background: var(--ds-slide-title-bg, var(--primary)); color: var(--ds-slide-title-fg, var(--primary-foreground)); }
.ds-X .ds-tpl-stage-top, .ds-X .ds-tpl-stage-foot { display: flex; justify-content: space-between; gap: 2cqw; font-family: var(--font-mono); font-size: 2.6cqw; letter-spacing: .08em; text-transform: uppercase; opacity: .8; }
.ds-X .ds-tpl-stage-foot { margin-top: auto; padding-top: 2cqw; border-top: 1px solid currentColor; }
.ds-X .ds-tpl-slide-h { margin: 6cqw 0 0; font-family: var(--font-display); font-size: var(--ds-slide-h-size, 10.5cqw); line-height: .95; letter-spacing: -.02em; font-weight: 700; max-width: 90%; }
.ds-X .ds-tpl-slide-sub { margin: 3cqw 0 0; font-size: 3.6cqw; line-height: 1.35; max-width: 70%; opacity: .85; }
.ds-X .ds-tpl-slide-big { margin: 2cqw 0 0; font-family: var(--font-display); font-size: 24cqw; line-height: .9; letter-spacing: -.03em; font-weight: 700; font-variant-numeric: tabular-nums; }
.ds-X .ds-tpl-slide-cap { margin: 2cqw 0 0; font-size: 3.4cqw; line-height: 1.35; max-width: 80%; }
.ds-X .ds-tpl-split { display: flex; margin-top: 4cqw; height: 9cqw; }
.ds-X .ds-tpl-split span { display: flex; align-items: center; padding: 0 2cqw; font-family: var(--font-mono); font-size: 3cqw; letter-spacing: .04em; }
.ds-X .ds-tpl-split-a { flex: 3; background: var(--ds-slide-split-a, var(--primary)); color: var(--ds-slide-split-a-fg, var(--primary-foreground)); } .ds-X .ds-tpl-split-b { flex: 2; background: var(--ds-slide-split-b, var(--chart-1)); color: var(--ds-slide-split-b-fg, var(--background)); }
.ds-X .ds-tpl-ed { padding: 28px 24px; }
.ds-X .ds-tpl-kicker { margin: 0 0 12px; color: var(--primary); }
.ds-X .ds-tpl-ed-h { margin: 0; max-width: 18ch; }
.ds-X .ds-tpl-deck { margin: 16px 0 0; font-size: 19px; line-height: 1.45; max-width: 52ch; color: var(--muted-foreground); }
.ds-X .ds-tpl-byline { margin: 16px 0 0; color: var(--muted-foreground); }
.ds-X .ds-tpl-ed-cols { display: grid; gap: 24px; margin-top: 24px; padding-top: 20px; border-top: var(--ds-tpl-rule, 1px solid var(--border)); }
.ds-X .ds-tpl-ed-body { margin: 0; font-size: 17px; line-height: 1.6; max-width: 60ch; }
.ds-X .ds-tpl-dropcap { float: left; font-family: var(--font-display); font-size: 56px; line-height: .8; padding: 6px 8px 0 0; font-weight: 700; color: var(--primary); }
.ds-X .ds-tpl-pull { display: grid; gap: 6px; align-content: start; padding: 16px 0 0; border-top: 3px solid var(--primary); }
.ds-X .ds-tpl-pull-n { font-size: clamp(28px, 3.2vw, 40px); line-height: 1; overflow-wrap: anywhere; }
.ds-X .ds-tpl-scrolly { display: grid; gap: 20px; }
.ds-X .ds-tpl-steps { display: grid; gap: 12px; align-content: start; }
.ds-X .ds-tpl-step { padding: 18px 20px; background: var(--card); border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); }
.ds-X .ds-tpl-step .t-label { color: var(--primary); } .ds-X .ds-tpl-step h4 { margin: 8px 0 0; } .ds-X .ds-tpl-step p { margin: 8px 0 0; font-size: 15px; line-height: 1.5; color: var(--muted-foreground); }
.ds-X .ds-tpl-figure { background: var(--ds-hand-bg, var(--muted)); border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); padding: 16px; align-self: start; }
.ds-X .ds-tpl-figure-art svg { display: block; width: 100%; height: auto; }
.ds-X .ds-tpl-figure-cap { margin: 10px 0 0; color: var(--muted-foreground); }
.ds-X .ds-tpl-rows { display: grid; margin-top: 4px; }
.ds-X .ds-tpl-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 15px; }
.ds-X .ds-tpl-row-name { font-weight: 600; } .ds-X .ds-tpl-row-meta { grid-column: 1; font-size: 13px; color: var(--muted-foreground); }
.ds-X .ds-tpl-row .ds-tpl-tag { grid-column: 2; grid-row: 1 / span 2; }
.ds-X .ds-tpl-tag { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: var(--ds-tag-radius, 999px); font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; line-height: 16px; background: var(--muted); color: var(--foreground); }
.ds-X .ds-tpl-tag.is-idle { background: var(--muted); color: var(--muted-foreground); }
.ds-X .ds-tpl-tag.is-ok { background: var(--ds-positive-soft); color: var(--ds-positive); } .ds-X .ds-tpl-tag.is-warn { background: var(--ds-caution-soft); color: var(--ds-caution); } .ds-X .ds-tpl-tag.is-bad { background: var(--ds-negative-soft); color: var(--ds-negative); }
.ds-X .ds-tpl-form { display: grid; gap: 14px; align-items: end; margin-top: 16px; padding-top: 16px; border-top: var(--ds-tpl-rule, 1px solid var(--border)); }
.ds-X .ds-tpl-landing { padding: 0; }
.ds-X .ds-tpl-hero { display: grid; gap: 20px; padding: 32px 24px; background: var(--ds-hero-bg, var(--background)); color: var(--ds-hero-fg, var(--foreground)); }
.ds-X .ds-tpl-hero .ds-row { color: var(--foreground); }
.ds-X .ds-tpl-hero-h { margin: 0; font-size: clamp(36px, 5.2vw, 64px); max-width: 14ch; }
.ds-X .ds-tpl-hero-sub { margin: 16px 0 24px; font-size: 18px; line-height: 1.5; max-width: 44ch; color: var(--ds-hero-muted, var(--muted-foreground)); }
.ds-X .ds-tpl-hero-art svg { display: block; width: 100%; height: auto; }
.ds-X .ds-tpl-feats { display: grid; gap: 0; border-top: var(--ds-tpl-rule, 1px solid var(--border)); }
.ds-X .ds-tpl-feat { padding: 20px 24px; border-bottom: 1px solid var(--border); } .ds-X .ds-tpl-feat h4 { margin: 0; } .ds-X .ds-tpl-feat p { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: var(--muted-foreground); }

.ds-X .ds-tpl-plan { padding: 24px; }
.ds-X .ds-tpl-plan-h { margin: 6px 0 0; }
.ds-X .ds-tpl-plan-brief { display: grid; gap: 14px; margin-top: 18px; padding-top: 16px; border-top: var(--ds-tpl-rule, 1px solid var(--border)); }
.ds-X .ds-tpl-plan-brief .t-label { color: var(--muted-foreground); } .ds-X .ds-tpl-plan-brief p { margin: 6px 0 0; font-size: 14px; line-height: 1.5; }
.ds-X .ds-tpl-plan-sub { margin: 28px 0 12px; color: var(--primary); }
.ds-X .ds-tpl-wires { display: grid; gap: 12px; }
.ds-X .ds-tpl-wire { background: var(--ds-hand-bg, var(--muted)); border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); padding: 12px; min-width: 0; }
.ds-X .ds-tpl-wire svg { display: block; width: 100%; height: auto; }
.ds-X .ds-tpl-wire-cap { margin: 10px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted-foreground); max-width: 70ch; }
.ds-X .ds-tpl-flow { border: var(--ds-tpl-edge, 1px solid var(--border)); border-radius: var(--ds-tpl-radius, var(--radius)); padding: 12px; background: var(--card); overflow-x: auto; }
.ds-X .ds-tpl-decisions { display: grid; gap: 12px; }
.ds-X .ds-tpl-decision { padding: 14px 16px; border-left: 3px solid var(--primary); background: var(--card); border-radius: 0 var(--ds-tpl-radius, var(--radius)) var(--ds-tpl-radius, var(--radius)) 0; }
.ds-X .ds-tpl-decision h4 { margin: 0; } .ds-X .ds-tpl-decision p { margin: 6px 0 0; font-size: 14px; line-height: 1.5; color: var(--muted-foreground); }
.ds-X .ds-tpl-ledger { width: 100%; border-collapse: collapse; font-size: 14px; border: 0; }
.ds-X .ds-tpl-ledger th, .ds-X .ds-tpl-ledger td { border-left: 0; border-right: 0; border-top: 0; background: transparent; text-align: left; padding: 10px 12px 10px 0; border-bottom: 1px solid var(--border); vertical-align: middle; }
.ds-X .ds-tpl-ledger th { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-foreground); font-weight: 600; border-bottom: var(--ds-tpl-rule, 1px solid var(--foreground)); }
.ds-X .ds-tpl-ledger s { color: var(--muted-foreground); }
.ds-X .ds-sample { margin: 48px 0 0; }
.ds-X .ds-rules { margin: 0; padding-left: 18px; line-height: 1.6; }
.ds-X .ds-rules li { margin-top: 6px; }
.ds-X .ds-map { width: 100%; border-collapse: collapse; font-size: 14px; border: 0; }
.ds-X .ds-map th, .ds-X .ds-map td { border-left: 0; border-right: 0; border-top: 0; background: transparent; }
.ds-X .ds-map th { text-align: left; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted-foreground); padding: 0 0 8px; border-bottom: 1px solid var(--foreground); font-weight: 600; }
.ds-X .ds-map td { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--border); }
.ds-X .ds-code { margin: 32px 0 0; padding: 20px; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius); font-size: 12px; line-height: 1.55; overflow-x: auto; }
.ds-X .ds-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 72px; padding: 20px 0 64px; border-top: 1px solid var(--border); font-size: 13px; color: var(--muted-foreground); }
@container (min-width: 760px) {
  .ds-X .ds-cover { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); padding: 56px 40px 56px; min-height: 600px; }
  .ds-X .ds-cover-art { order: 0; align-self: stretch; aspect-ratio: auto; display: flex; align-items: flex-end; justify-content: flex-end; }
  .ds-X .ds-cover-art svg { width: 100%; height: auto; max-height: 100%; }
  .ds-X .ds-wrap { padding: 0 40px; }
  .ds-X .ds-two { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-three { grid-template-columns: 1fr 1fr 1fr; }
  .ds-X .ds-type-row { grid-template-columns: minmax(0, 1fr) 280px; align-items: baseline; }
  .ds-X .ds-type-meta { flex-direction: column; gap: 4px; }
  .ds-X .ds-comp-grid { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-comp-wide { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-hand-rules { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-hand { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-tpl-wires { grid-template-columns: 3fr 2fr; }
  .ds-X .ds-tpl-plan-brief { grid-template-columns: 1fr 1fr 1fr; }
  .ds-X .ds-tpl-decisions { grid-template-columns: 1fr 1fr 1fr; }
  .ds-X .ds-motifs { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-principles { grid-template-columns: 1fr 1fr; gap: 40px; }
  .ds-X .ds-tpl-head { flex-wrap: nowrap; } .ds-X .ds-tpl-head h3 { flex: 0 0 160px; }
  .ds-X .ds-tpl-kpis { grid-template-columns: 1fr 1fr 1fr; }
  .ds-X .ds-tpl-dash-grid { grid-template-columns: 3fr 2fr; }
  .ds-X .ds-tpl-slides { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-tpl-ed-cols { grid-template-columns: minmax(0, 1fr) 220px; }
  .ds-X .ds-tpl-scrolly { grid-template-columns: 1fr 1fr; }
  .ds-X .ds-tpl-form { grid-template-columns: 1fr 1fr auto; }
  .ds-X .ds-tpl-hero { grid-template-columns: 3fr 2fr; align-items: center; padding: 48px 40px; }
  .ds-X .ds-tpl-feats { grid-template-columns: 1fr 1fr 1fr; } .ds-X .ds-tpl-feat { border-bottom: 0; border-right: 1px solid var(--border); } .ds-X .ds-tpl-feat:last-child { border-right: 0; }
  .ds-X .ds-tpl-row { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto; } .ds-X .ds-tpl-row-meta { grid-column: auto; } .ds-X .ds-tpl-row .ds-tpl-tag { grid-column: auto; grid-row: auto; }
}
@container (min-width: 1100px) {
  .ds-X .ds-comp-grid { grid-template-columns: 1fr 1fr 1fr; }
  .ds-X .ds-motifs { grid-template-columns: 1fr 1fr 1fr; }
  .ds-X .ds-hand { grid-template-columns: 1fr 1fr 1fr 1fr; }
}
`;
