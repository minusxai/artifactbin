/** The systems index page: one card per published system with its own cover, tokens and display face. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { esc } from './py.mjs';
import { fontFaceCss } from './fonts.mjs';
import { CATALOGUE, PAGES_DIR, ROSTER, fence, loadSpec } from './pages.mjs';

export function buildIndex(existing) {
  const { fit: FIT, heads: TPL_HEADS, sources: SOURCES, pageIds } = CATALOGUE;
  const cards = [], css = [], faces = [];
  const specs = Object.fromEntries(ROSTER.map((slug) => [slug, loadSpec(slug)]));
  for (const slug of ROSTER) {
    const S = specs[slug];
    const aid = pageIds[slug];
    const fam = S.families, fonts = S.fonts;
    faces.push(fontFaceCss(...fonts[0]));
    // scope the system's light tokens on its card so the cover is drawn in its own palette
    const tok = S.tokens.map((t) => `--ds-${t.name}: ${t.light}`).join('; ');
    const tokd = S.tokens.map((t) => `--ds-${t.name}: ${t.dark}`).join('; ');
    const val = (v, mode) => (v && typeof v === 'object' ? v[mode] : v);
    const extra = Object.entries(S.extra_vars ?? {}).filter(([, v]) => val(v, 'light') !== null && val(v, 'light') !== undefined).map(([k, v]) => `--ds-${k}: ${val(v, 'light')}`).join('; ');
    const extrad = Object.entries(S.extra_vars ?? {}).filter(([, v]) => val(v, 'dark') !== null && val(v, 'dark') !== undefined).map(([k, v]) => `--ds-${k}: ${val(v, 'dark')}`).join('; ');
    const contract = Object.entries(S.contract).map(([k, v]) => `--${k}: var(--ds-${v})`).join('; ');
    const fams = `--font-display: ${fam.display}; --font-body: ${fam.sans}; --font-mono: ${fam.mono}`;
    css.push(`.ds-${slug} { ${tok}; ${extra}; ${contract}; ${fams} }\n.dark .ds-${slug} { ${tokd}; ${extrad} }`);
    // the system's own css, scoped already by .ds-<slug>; keep it all
    css.push(S.css ?? '');
    const firstMode = S.color_mode === 'dark' ? 'Night first' : 'Day first';
    cards.push(`<a className="ix-card ds-${slug}" href="/a/${aid}">
  <div className="ix-cover">${S.cover_svg}</div>
  <div className="ix-meta">
    <div className="ix-row"><span className="ix-mood">${esc(S.mood)}</span><span className="ix-use">${esc(S.jobs)}</span></div>
    <h2 className="ix-name">${esc(S.name)}</h2>
    <p className="ix-tag">${esc(S.tagline)}</p>
    <p className="ix-idea">${esc(S.idea_headline)} ${esc(S.use_for.split('.')[0])}.</p>
    <div className="ix-row2"><span className="ix-fonts">${esc(fonts.map(([f]) => f).join(' · '))}</span><span className="ix-sw">${S.tokens.slice(0, 7).map((t) => `<i className="ix-sw-${t.name}"></i>`).join('')}</span></div>
    <p className="ix-src">${esc(firstMode)} · from: ${esc(SOURCES[slug])}</p>
    <span className="ix-open">Open ${esc(S.name)} →</span>
  </div>
</a>`);
    css.push(S.tokens.slice(0, 7).map((t) => `.ds-${slug} .ix-sw-${t.name} { background: var(--ds-${t.name}); }`).join('\n'));
  }
  const style = `
${faces.join('\n')}
.ix { font-family: "Schibsted Grotesk", system-ui, sans-serif; }
.ix-wrap { max-width: 1240px; margin: 0 auto; padding: 48px 20px 80px; }
.ix-head { max-width: 1000px; margin-bottom: 36px; }
.ix-h1 { margin: 0; font-size: clamp(36px, 6vw, 64px); line-height: 1; letter-spacing: -.03em; font-weight: 700; text-wrap: balance; }
.ix-lede { margin: 16px 0 0; font-size: 18px; line-height: 1.5; color: var(--muted-foreground); max-width: 64ch; }
.ix-policies { display: grid; gap: 16px; margin-top: 24px; }
.ix-policies > div { padding: 16px 18px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); }
.ix-pol-k { margin: 0 0 6px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.ix-policies p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--muted-foreground); }
.ix-policies > div .ix-pol-k { color: var(--foreground); }
.ix-coord { margin: 40px 0 48px; padding-top: 32px; border-top: 1px solid var(--border); max-width: 1000px; }
.ix-h2 { margin: 0; font-size: 28px; line-height: 1.1; letter-spacing: -.02em; font-weight: 700; }
.ix-h3 { margin: 36px 0 12px; font-size: 18px; font-weight: 700; }
.ix-steps { margin: 20px 0 0; padding-left: 22px; font-size: 15px; line-height: 1.55; display: grid; gap: 10px; max-width: 76ch; }
.ix-steps b { font-weight: 700; }
.ix-own { margin-top: 28px; overflow-x: auto; }
.ix-table { width: 100%; border-collapse: collapse; font-size: 14px; border: 0; }
.ix-table th, .ix-table td { border-left: 0; border-right: 0; border-top: 0; background: transparent; text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
.ix-table th { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-foreground); font-weight: 600; border-bottom: 1px solid var(--foreground); }
.ix-fit td { padding: 7px 8px 7px 0; }
.ix-fit-2 { font-weight: 700; } .ix-fit-1 { color: var(--foreground); } .ix-fit-0 { color: var(--muted-foreground); opacity: .55; }
.ix-fine { margin: 12px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted-foreground); max-width: 80ch; }
.ix-grid { margin-top: 20px; }
.ix-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.ix-legend span { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted-foreground); border: 1px solid var(--border); padding: 3px 9px; border-radius: 999px; }
.ix-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
.ix-card { display: flex; flex-direction: column; background: var(--ds-cover-bg, var(--background)); color: var(--foreground); text-decoration: none; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; transition: transform 160ms ease, box-shadow 160ms ease; }
.ix-card:hover { transform: translateY(-3px); box-shadow: 0 14px 34px -14px rgba(0,0,0,.35); }
.ix-cover { aspect-ratio: 480 / 288; overflow: hidden; border-bottom: 1px solid var(--border); background: var(--ds-cover-bg, var(--background)); }
.ix-cover svg { display: block; width: 100%; height: 100%; }
.ix-meta { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px 18px; background: var(--card); color: var(--card-foreground); }
.ix-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ix-mood { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; background: var(--foreground); color: var(--background); padding: 3px 8px; border-radius: 3px; }
.ix-use { font-size: 13px; color: var(--muted-foreground); }
.ix-name { margin: 2px 0 0; font-family: var(--font-display); font-size: 40px; line-height: 1; font-weight: 700; }
.ix-tag { margin: 0; font-size: 15px; color: var(--muted-foreground); }
.ix-idea { margin: 0; font-size: 14px; line-height: 1.5; max-width: 60ch; }
.ix-row2 { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
.ix-fonts { font-size: 12px; color: var(--muted-foreground); }
.ix-sw { display: inline-flex; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
.ix-sw i { display: block; width: 16px; height: 16px; }
.ix-src { margin: 0; font-size: 12px; color: var(--muted-foreground); }
.ix-open { font-size: 13px; font-weight: 700; margin-top: 4px; }
.ix-foot { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: 13px; max-width: 72ch; line-height: 1.5; }
@container (min-width: 700px) { .ix-grid { grid-template-columns: 1fr 1fr; } .ix-policies { grid-template-columns: 1fr 1fr 1fr; } .ix-wrap { padding: 64px 40px 96px; } }
@container (min-width: 1100px) { .ix-grid { grid-template-columns: 1fr 1fr 1fr; } }
${css.join('\n')}
`;
  const spec = { name: 'Thirteen systems', tagline: 'Thirteen design systems for artifactbin: tokens, type, a hand, seven page-type specimens and the binding, each proven on the live reader in both modes.', color_mode: 'light' };
  const body = `<Helmet>
<title>Thirteen systems — artifactbin design systems</title>
<style>{\`${style}\`}</style>
</Helmet>
<div data-design="tw" className="@container ix bg-background text-foreground">
<div className="ix-wrap">
<header className="ix-head">
  <h1 className="ix-h1">Thirteen systems</h1>
  <p className="ix-lede">Thirteen design systems for artifactbin. Each page is also its own specimen: tokens for both modes, type roles, the hand it draws with, seven specimens (one per page type: dashboard, deck, editorial, scrolly, plan, app, landing), a first viewport in use, and the Helmet binding to copy. Six come from the blind-round winners you picked; the rest are kept, reworked or new.</p>
  <div className="ix-policies">
    <div><p className="ix-pol-k">Three layers, each works alone</p><p>The binding block is the floor: paste it and kit pages already look right. The hand is the middle: one drawing mode and a few named devices. The page-type specimens are recipes to copy.</p></div>
    <div><p className="ix-pol-k">Template owns the grid, system owns the look</p><p>Dashboard grids, slide stages and scrolly step columns stay in the template references. Each system page shows how it wears all seven.</p></div>
    <div><p className="ix-pol-k">Borrow devices, never palettes</p><p>Devices are written against the hand variables, so a stripe screen or a stamp drops into another system and takes its ink. One system per artifact owns colour and type; the object you draw comes from the subject.</p></div>
  </div>
  <div className="ix-legend"><span>Loud</span><span>Technical</span><span>Sleek</span><span>Evidential</span><span>Printed</span><span>Warm</span><span>Poster</span><span>Atmospheric</span><span>Editorial</span><span>Utilitarian</span><span>Fun</span></div>
</header>
<section className="ix-coord">
  <h2 className="ix-h2">How a page comes together</h2>
  <p className="ix-lede">The template is the shape of the content; the system is the hand that draws it; the subject supplies the object and the data. Three choices, made in that order, each from its own reference. The system page is not a substitute for the template reference and does not try to be: the specimen shows the look at one viewport and the hooks to use, while the template reference carries the beats, the behaviours (sticky figures, the contents rail, striking done tasks, the Mermaid flow) and its own don&#39;ts. When they disagree, the template wins on structure and the system wins on look.</p>
  <ol className="ix-steps">
    <li><b>Shape first.</b> Pick the page type from the content&#39;s shape: dashboard, deck, editorial, scrolly, plan, app or landing. Five have a template reference; app and landing publish without a template field. Read the page type&#39;s reference for its beats before anything else.</li>
    <li><b>Then the hand.</b> Pick the system from the subject&#39;s world and the fit table below. A system marked avoid for a template can still be used; it will cost custom CSS the specimen does not give you.</li>
    <li><b>Bind.</b> Paste the system&#39;s 10 · Binding block and its @font-face rules into the Helmet style, set the fence theme to the system&#39;s base, and leave a Helmet comment naming the system.</li>
    <li><b>Dress the template.</b> Open the system&#39;s 07 specimen for that template and take its classes and hook variables; keep the template&#39;s structure. The specimen is the look, not the layout.</li>
    <li><b>Draw from the subject.</b> Choose one object from the artifact&#39;s own world, draw it in the hand (06), and put the data inside one device. The system never supplies the object.</li>
    <li><b>Override by token, borrow by device.</b> Reassign a single --ds-* token to change the whole page; never restyle components one by one. Devices port between systems; palettes and type pairings do not.</li>
    <li><b>Check.</b> One loud element per view, both modes, phone width, and the template&#39;s own checklist.</li>
  </ol>
  <div className="ix-own">
    <table className="ix-table"><thead><tr><th>Decision</th><th>Template reference</th><th>System page</th><th>The artifact (subject)</th></tr></thead><tbody>
      <tr><td>Beats and order</td><td>owns</td><td>shows one viewport</td><td>may cut or reorder beats</td></tr>
      <tr><td>Grid, measure, stage, step column</td><td>owns</td><td>wears it (07)</td><td>—</td></tr>
      <tr><td>Tokens, type roles, radius, modes</td><td>—</td><td>owns (02–04, 10)</td><td>overrides one token at most</td></tr>
      <tr><td>Component look</td><td>—</td><td>owns (05)</td><td>—</td></tr>
      <tr><td>Drawing style, devices, motion</td><td>names what is needed (a figure, a flow)</td><td>owns (06)</td><td>picks the object and which device carries the data</td></tr>
      <tr><td>Copy, data, chart types</td><td>—</td><td>—</td><td>owns</td></tr>
    </tbody></table>
  </div>
  <h3 className="ix-h3">Where each system is strongest</h3>
  <table className="ix-table ix-fit"><thead><tr><th>System</th>${TPL_HEADS.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
  ${ROSTER.map((s) => `<tr><td>${specs[s].name}</td>` + FIT[s].map((v) => `<td className="ix-fit-${v}">${['avoid', 'good', 'best'][v]}</td>`).join('') + '</tr>').join('')}
  </tbody></table>
  <p className="ix-fine">Best: the specimen is close to finished. Good: the specimen works with the template&#39;s own structure. Avoid: the system&#39;s hand fights the template; expect custom CSS.</p>
</section>
<h2 className="ix-h2">The systems</h2>
<div className="ix-grid">
${cards.join('\n')}
</div>
<footer className="ix-foot">Every system binds through the same contract: its own --ds-* tokens, the artifactbin keys pointed at them, @font-face rules for every weight it uses, and a Helmet comment recording the choice. Sources are in design-systems/ in the artifactbin checkout: node scripts/design-systems.mjs pages regenerates the pages and this index, and the same specs feed the runtime registry and the agent-facing references. Each page's hand section draws the same three subjects (an object, a place, a quantity) so the technique is what you copy, not the picture.</footer>
</div>
</div>
`;
  return fence(spec, existing) + body;
}

export function writeIndex(dir = PAGES_DIR) {
  const file = path.join(dir, 'index.jsx');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const out = buildIndex(existing);
  writeFileSync(file, out);
  return { path: file, bytes: Buffer.byteLength(out) };
}
