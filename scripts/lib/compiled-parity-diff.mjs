/**
 * THE PARITY GATE'S COMPARISON (scripts/gate-compiled-parity.mjs), apart from the browser so its
 * one tolerance is testable.
 *
 * Two snapshots of `#mx-story-root` — legacy (today's React render) and compiled — each a tree of
 * `{ tag, attrs, refs, style, box, text, kids }` as the gate's in-page SNAPSHOT serialises it:
 * `attrs` with generated ids normalised, `refs` naming each idref attribute `resolved` or `dangling`
 * as the page's own `document.getElementById` found it.
 *
 * ONE ACCEPTED DIFFERENCE, the same as the unit helper's (services/app/lib/islands/__tests__/kit-parity.ts
 * `diffShapes`): an `aria-controls` / `aria-labelledby` whose LEGACY value is a single id that names
 * no element on the legacy page (a dangling Radix id, when an author gave the parts their own ids).
 * The compiled page may point at the real element instead. Nothing broader: a legacy idref that
 * resolves, or that lists several ids, must be matched exactly, and so must its resolution.
 */

/** Is this attribute's difference the accepted one: a single dangling legacy aria-controls/-labelledby? */
export function danglingLegacyRef(legacy, name) {
  if (name !== 'aria-controls' && name !== 'aria-labelledby') return false;
  const value = legacy.attrs[name];
  return typeof value === 'string' && value !== '' && !/\s/.test(value) && legacy.refs[name] === 'dangling';
}

function compare(a, b, path, out) {
  if (!a || !b || a.tag !== b.tag) { out.structure.push(`${path}: ${a?.tag} vs ${b?.tag}`); return; }
  out.elements++;
  for (const n of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) {
    if (a.attrs[n] === b.attrs[n] || danglingLegacyRef(a, n)) continue;
    out.attrs.push(`${path}<${a.tag}> @${n}: ${JSON.stringify(a.attrs[n])?.slice(0, 80)} vs ${JSON.stringify(b.attrs[n])?.slice(0, 80)}`);
  }
  for (const n of new Set([...Object.keys(a.refs), ...Object.keys(b.refs)])) {
    if (a.refs[n] === b.refs[n] || danglingLegacyRef(a, n)) continue;
    out.refs.push(`${path}<${a.tag}> ${n}: ${a.refs[n]} vs ${b.refs[n]}`);
  }
  if (a.text !== b.text) out.text.push(`${path}<${a.tag}>: ${JSON.stringify(a.text).slice(0, 60)} vs ${JSON.stringify(b.text).slice(0, 60)}`);
  for (const p of Object.keys(a.style)) if (a.style[p] !== b.style[p]) out.style.push(`${path}<${a.tag}> ${p}: ${a.style[p]} vs ${b.style[p]}`);
  if (a.box.join() !== b.box.join()) out.box.push(`${path}<${a.tag}> ${a.box.join(',')} vs ${b.box.join(',')}`);
  if (a.kids.length !== b.kids.length) { out.structure.push(`${path}<${a.tag}> children ${a.kids.length} vs ${b.kids.length}`); return; }
  a.kids.forEach((k, i) => compare(k, b.kids[i], `${path}.${i}`, out));
}

/** Every difference between the legacy and compiled story trees, by kind. */
export function diffTrees(legacy, compiled) {
  const out = { elements: 0, attrs: [], refs: [], text: [], style: [], box: [], structure: [] };
  if (legacy.length !== compiled.length) out.structure.push(`root children ${legacy.length} vs ${compiled.length}`);
  legacy.forEach((n, i) => compare(n, compiled[i], String(i), out));
  return out;
}

/**
 * SERVED-ELEMENT SURVIVAL on the compiled page: every element the server sent must still be in the story
 * once it has hydrated. ONE EXEMPTION: the placeholder of a `<Mermaid>` figure served undrawn
 * (`figure[data-mx-mermaid-state="pending"] > p[role="status"]`, "Rendering diagram…", and anything in it)
 * — both pages replace it with the drawing by design. Nothing else is excused: not a drawn figure's
 * image, not the figure itself, not any other placeholder.
 *
 * `records`: one per served element, `{ kept, undrawnMermaid }` — kept: still connected inside the story
 * root; undrawnMermaid: the element was, when parsed, that placeholder or inside it.
 */
export function survivalOf(records) {
  const served = records.length;
  const survived = records.filter((r) => r.kept).length;
  const exempt = records.filter((r) => !r.kept && r.undrawnMermaid).length;
  return { served, survived, exempt, ok: served > 0 && survived + exempt === served };
}
