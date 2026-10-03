/**
 * Gate: a real library in a real document — a Helmet script imports three.js BY NAME (resolved at publish
 * to esm.sh, pinned), renders WebGL into a node of the markup, and the page proves it: the same module on a
 * second import, red pixels a GPU produced, the same after hydration inside a kit Card, and an ordinary
 * prose document that loads no library at all. A cold export of the unvisited document is still a PNG.
 *
 * Needs the network to reach esm.sh (the browser fetches the package from it, as a reader's does).
 *
 *   usage: node scripts/gates/gate-libraries.mjs [base]
 */
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createChecker } from './lib/assert.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const base = process.argv[2] ?? 'http://localhost:3040';
const check = createChecker('libraries');
const { token } = await connectAgent(base);
const authorization = `Bearer ${token}`;
const create = async body => {
  const res = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
};

const THREE_SPEC = 'three@0.170.0';
const script = [
  `import * as THREE from '${THREE_SPEC}';`,
  `import { OrbitControls } from '${THREE_SPEC}/examples/jsm/controls/OrbitControls.js';`,
  'try {',
  `  window.__sameLibrary = THREE === await import('${THREE_SPEC}');`,
  "  const canvas = document.getElementById('scene');",
  '  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });',
  '  renderer.setSize(400, 300, false);',
  "  const scene = new THREE.Scene(); scene.background = new THREE.Color('#101820');",
  '  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100); camera.position.z = 4;',
  '  const controls = new OrbitControls(camera, canvas); controls.update();',
  '  const geometry = new THREE.BufferGeometry();',
  "  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3));",
  "  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#ef3340', side: THREE.DoubleSide })));",
  '  renderer.render(scene, camera);',
  '  const gl = renderer.getContext(); const pixel = new Uint8Array(4);',
  '  gl.readPixels(200, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);',
  "  window.__pixel = Array.from(pixel); window.__painted = true; canvas.setAttribute('data-painted', '');",
  "} catch (error) { window.__sceneError = String(error?.message ?? error); }",
].join('\n');
const helmet = '<Helmet><title>Three.js library gate</title><script>{' + JSON.stringify(script) + '}</script></Helmet>';
const canvas = '<canvas id="scene" width="400" height="300" />';
const doc = await create({ title: 'Three.js library gate', markup: helmet + canvas });
const prose = await create({ markup: '<h1>Ordinary prose</h1>' });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  // Export before an interactive visit could warm anything.
  const exported = await fetch(`${base}/a/${doc.id}/export?format=png`);
  check(exported.status === 200 && exported.headers.get('content-type')?.startsWith('image/png'),
    `a cold export of an unvisited WebGL document is a PNG (${exported.status})`);

  const page = await browser.newPage();
  page.on('pageerror', error => console.error('PAGE',error.message));
  page.on('console', message => { if(message.type()==='error')console.error('CONSOLE',message.text()); });
  const libraries = [];
  page.on('request', req => { if (/\/libraries\/|esm\.sh/.test(req.url())) libraries.push(req.url()); });
  await page.goto(`${base}/a/${prose.id}/raw`);
  await page.waitForTimeout(500);
  check(libraries.length === 0, `an ordinary prose document loads no library at all (${libraries.join(' ')})`);
  const scene = async (id) => {
    await page.goto(`${base}/a/${id}/raw`);
    await page.waitForFunction(() => window.__painted || window.__sceneError, null, { timeout: 30000 }).catch(async error => {
      throw new Error(`${error.message}; body=${(await page.locator('body').innerText()).slice(0, 1000)}`);
    });
    return page.evaluate(() => ({ error: window.__sceneError, pixel: window.__pixel, same: window.__sameLibrary, painted: document.getElementById('scene')?.hasAttribute('data-painted') }));
  };
  const state = await scene(doc.id);
  check(state.error === undefined, `the scene ran without error (${state.error ?? 'none'})`);
  check(state.same === true, 'a second import of the library is the same module, not a second copy');
  check(state.pixel[0] > state.pixel[1] * 2, `the model painted real WebGL pixels (${state.pixel})`);
  check(state.painted === true, 'the script rendered into the markup\'s own canvas node');
  check(libraries.some(url => url.startsWith('https://esm.sh/three@0.170.0')), `the package came from esm.sh at the pinned version (${libraries.slice(0, 3).join(' ')})`);
  const hydrated = await create({ markup: helmet + `<Card><CardContent>${canvas}</CardContent></Card>` });
  const inCard = await scene(hydrated.id);
  check(inCard.error === undefined, `the script runs after hydration inside a kit Card too (${inCard.error ?? 'none'})`);
  check(inCard.painted === true && inCard.pixel[0] > inCard.pixel[1] * 2, `and the hydrated copy painted as well (${inCard.pixel})`);
} finally { await browser.close(); }
check.done();
