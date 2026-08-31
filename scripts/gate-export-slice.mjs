/**
 * Gate: A DECK IS CHECKED ONE SLIDE AT A TIME.
 *
 * An agent reviews its own deck by looking at it, and the only shot it could
 * ask for was the WHOLE document — six full-viewport slides in one tall PNG,
 * every slide too small to read. Measured on a real run, Claude Opus 5 guessed
 * `?slide=2`, `?full=1`, `?mode=full` and `?print=1` (all of which silently
 * returned the same full page), then worked around the gap by PUBLISHING a
 * throwaway document holding one slide, exporting that, and deleting it —
 * three extra requests and a version row for every look.
 *
 * `?slide=N` is that look, done properly. This needs a live server because the
 * claim is about pixels: the slice must be ONE SCREEN of the deck, not the
 * document, and slide 2 must differ from slide 1.
 *
 *   usage: node scripts/gate-export-slice.mjs [base]
 */
import { startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const ok = (pass, label) => { console.log(`${pass ? '  ok ' : 'FAIL '} ${label}`); if (!pass) failures.push(label); };

const slide = (n, body) => `<Slide title="Slide ${n}" className="justify-center p-16">${body}</Slide>`;
const DECK =
  '<Helmet><title>Slice gate</title></Helmet>'
  + '<SlideDeck>'
  + slide(1, '<h1 className="text-6xl font-bold">First slide</h1><p className="mt-6 text-lg">The cover of the deck.</p>')
  + slide(2, '<h2 className="text-5xl font-bold">Second slide</h2><p className="mt-6 text-lg">A different claim entirely.</p>')
  + slide(3, '<h2 className="text-5xl font-bold">Third slide</h2><p className="mt-6 text-lg">And a third.</p>')
  + '</SlideDeck>';

/** PNG dimensions straight from the IHDR chunk — no image library for two integers. */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function shot(id, query = '') {
  const res = await fetch(`${BASE}/a/${id}/export${query}`);
  const body = res.headers.get('content-type')?.startsWith('image/')
    ? Buffer.from(await res.arrayBuffer())
    : await res.json().catch(() => null);
  return { status: res.status, body };
}

const start = await startDocument(BASE);
const put = await fetch(`${BASE}/api/artifacts/${start.id}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${start.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Slice gate', markup: DECK, template: 'deck', theme: 'industry' }),
});
ok(put.status === 200, `published the deck (${put.status})`);

const whole = await shot(start.id);
const one = await shot(start.id, '?slide=1');
const two = await shot(start.id, '?slide=2');

if (whole.status !== 200 || one.status !== 200) {
  ok(false, `renders available (whole ${whole.status}, slide ${one.status}) — is a headless browser installed?`);
} else {
  const w = pngSize(whole.body);
  const s1 = pngSize(one.body);
  ok(s1.height < w.height, `a slide is ONE SCREEN, not the document (slide ${s1.height}px < deck ${w.height}px)`);
  ok(s1.height > 200, `a slide is a real screen, not a sliver (${s1.height}px)`);
  ok(two.status === 200 && !one.body.equals(two.body), 'slide 2 is a different picture from slide 1');
}

// The full shot must run PAST THE FOLD. `/docs/artifact-bin/references/publishing-versions.md` promises "the fully
// rendered page" and it was one viewport for every markup document — the shot
// photographed the app page's iframe element, whose box is the viewport.
const TALL = '<div className="p-10"><h1>Tall</h1>'
  + Array.from({ length: 40 }, (_, i) => `<p>filler paragraph ${i}, long enough that this document runs well past a single screen.</p>`).join('')
  + '</div>';
const tallStart = await startDocument(BASE);
await fetch(`${BASE}/api/artifacts/${tallStart.id}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${tallStart.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Tall', markup: TALL }),
});
const tall = await shot(tallStart.id);
ok(tall.status === 200 && pngSize(tall.body).height > 1000,
  `a full export photographs past the fold (${tall.status === 200 ? pngSize(tall.body).height + 'px' : tall.status})`);

// Past the end is a missing RESOURCE, and the count is what lets the caller fix
// itself in one step rather than probing.
const past = await shot(start.id, '?slide=9');
ok(past.status === 404 && past.body?.error === 'slide_not_found' && past.body?.slides === 3,
  `slide past the end 404s with the count (${past.status} ${JSON.stringify(past.body)})`);

const bad = await shot(start.id, '?slide=two');
ok(bad.status === 400 && bad.body?.error === 'unknown_slide',
  `a malformed slide is refused, never silently the whole page (${bad.status})`);

console.log(failures.length ? `\nFAILED: ${failures.length}` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
