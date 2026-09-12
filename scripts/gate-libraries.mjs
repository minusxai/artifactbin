/**
 * Gate: a real sandbox with a real library in it — optional library loading,
 * GLB assets, WebGL pixels, isolation and a COLD export.
 *
 * Every verdict below is a browser fact: that the managed realm resolved the
 * library from our own asset cache rather than the source URL, that the same
 * module identity is handed back on a second import, that the textured model
 * actually painted red pixels a GPU produced, and that the exporter waited for
 * all of it on a document nobody had visited yet.
 *
 *   usage: node scripts/gate-libraries.mjs [base]
 */
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';
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

// A self-contained, textured triangle. Its embedded PNG exercises blob: reads
// inside GLTFLoader as well as the model's network fetch through resolve().
const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ef3340' } }).png().toBuffer();
const positions = Buffer.from(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]).buffer);
const uv = Buffer.from(new Float32Array([0, 0, 1, 0, 0.5, 1]).buffer);
const bin = Buffer.concat([positions, uv, png]);
const model = {
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 }, doubleSided: true }],
  textures: [{ source: 0 }], images: [{ bufferView: 2, mimeType: 'image/png' }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [{ buffer: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: uv.length }, { buffer: 0, byteOffset: positions.length + uv.length, byteLength: png.length }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
};
const json = Buffer.from(JSON.stringify(model));
const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const paddedBin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + paddedJson.length + paddedBin.length, 8);
const chunk = (body, kind) => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length); h.writeUInt32LE(kind, 4); return Buffer.concat([h, body]); };
const glb = Buffer.concat([header, chunk(paddedJson, 0x4e4f534a), chunk(paddedBin, 0x004e4942)]);
const upload = await fetch(`${base}/api/artifacts?format=file&filename=triangle.glb`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'model/gltf-binary' }, body: glb });
assert.equal(upload.status, 201, await upload.clone().text());
const file = await upload.json();
const libraryUrl = `${base}/libraries/three-0.185.1/index.js`;
const script = `
    // Keep the first render cold past the exporter's former fixed 1500ms settle.
    await new Promise(resolve => setTimeout(resolve, 1800));
    const library = document.scripts[document.scripts.length - 2].src;
    window.__librarySource = library;
    const THREE = await import(library);
    window.__sameLibrary = THREE === await import(library);
    const canvas = document.getElementById('scene');
    const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
    renderer.setSize(400, 300);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#101820');
    const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100); camera.position.z = 4;
    const controls = new THREE.OrbitControls(camera, canvas); controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 3));
    const bytes = await (await fetch('ref:${file.id}')).arrayBuffer();
    const model = await new THREE.GLTFLoader().parseAsync(bytes, '');
    scene.add(model.scene); renderer.render(scene, camera);
    const pixel = new Uint8Array(4); renderer.getContext().readPixels(200, 150, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixel);
    window.__pixel = Array.from(pixel); window.__painted = true;
    addEventListener('pagehide', () => { controls.dispose(); renderer.dispose(); });
`;
const scene = '<Iframe title="Three.js scene" height={300}><canvas id="scene" width="400" height="300" /><script id="three-bundle" type="module" src="' + libraryUrl + '"/><script type="module">{`' + script + '`}</script></Iframe>';
const doc = await create({ title: 'Three.js library gate', markup: scene });
const prose = await create({ markup: '<h1>Ordinary prose</h1>' });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  // Export before an interactive visit can warm the managed asset/module path.
  const exported = await fetch(`${base}/a/${doc.id}/export?format=png`);
  check(exported.status === 200 && exported.headers.get('content-type')?.startsWith('image/png'),
    `a cold export of an unvisited WebGL document is a PNG (${exported.status})`);
  const { data, info } = await sharp(Buffer.from(await exported.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 100 && data[i] > data[i + 1] * 2 && data[i] > data[i + 2] * 2) red++;
  check(red > 100, `the cold export waited for the rendered red model (${red} red pixels)`);

  const page = await browser.newPage();
  page.on('pageerror', error => console.error('PAGE',error.message));
  page.on('console', message => { if(message.type()==='error')console.error('CONSOLE',message.text()); });
  const libraries = [];
  page.on('request', req => { if (req.url().includes('/libraries/')) libraries.push(req.url()); });
  await page.goto(`${base}/a/${prose.id}/raw`);
  check(libraries.length === 0, 'an ordinary prose document loads no optional library at all');
  await page.goto(`${base}/a/${doc.id}/raw`);
  const realm = async () => {
    const outer = page.locator('iframe[title="Three.js scene"]'); await outer.waitFor({timeout:10_000}).catch(async error=>{throw new Error(`${error.message}; body=${(await page.locator('body').innerText()).slice(0,1000)}`);});
    const wrapper = await outer.contentFrame(); const inner = wrapper.locator('iframe'); await inner.waitFor();
    return (await inner.elementHandle()).contentFrame();
  };
  let managed = await realm();
  await managed.waitForFunction(() => window.__painted || window.__sceneError, { timeout: 15000 });
  const state = await managed.evaluate(() => ({ error: window.__sceneError, pixel: window.__pixel, same: window.__sameLibrary, source: window.__librarySource }));
  check(state.error === undefined, `the scene ran without error (${state.error ?? 'none'})`);
  check(state.same === true, 'a second import of the library is the same module, not a second copy');
  check(state.pixel[0] > state.pixel[1] * 2, `the textured model painted real WebGL pixels (${state.pixel})`);
  check(/\/assets\//.test(state.source), `the library source was rewritten to the managed asset cache (${state.source})`);
  check(libraries.length === 0, 'and the browser never reached the original library URL directly');
  const blocked = await managed.evaluate(async () => {
    const missing = await fetch('ref:Miss12').then(response => response.status === 404, () => true);
    const network = await fetch('http://169.254.169.254/latest/meta-data').then(() => false, () => true);
    let storage = false; try { localStorage.getItem('x'); } catch { storage = true; }
    return { missing, network, storage };
  });
  check(blocked.missing && blocked.network && blocked.storage,
    `inside the realm a missing ref 404s and network and storage stay blocked (${JSON.stringify(blocked)})`);
  const hydrated = await create({ markup: `<Card><CardContent>${scene}</CardContent></Card>` });
  await page.goto(`${base}/a/${hydrated.id}/raw`);
  managed = await realm();
  await managed.waitForFunction(() => window.__painted || window.__sceneError, { timeout: 15000 });
  check(await managed.evaluate(() => window.__sceneError) === undefined,
    'the generic bundle and the ref fetch work after hydration too');
  check(await managed.evaluate(() => window.__painted) === true, 'and the hydrated copy painted as well');
} finally { await browser.close(); }
check.done();
