/** Real sandbox: optional library loading, GLB assets, WebGL paint, isolation, export. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mintAnon } from './lib/mint-anon.mjs';

const base = process.argv[2] ?? 'http://localhost:3040';
const { token } = await mintAnon(base);
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
const script = `
  (async () => {
    const THREE = await artifact.library('three');
    window.__sameLibrary = THREE === await artifact.library('three');
    const canvas = document.getElementById('scene');
    const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
    renderer.setSize(400, 300);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#101820');
    const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100); camera.position.z = 4;
    const controls = new THREE.OrbitControls(camera, canvas); controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 3));
    const model = await new THREE.GLTFLoader().loadAsync(await artifact.resolve('ref:${file.id}'));
    scene.add(model.scene); renderer.render(scene, camera);
    window.__camera=camera.position.toArray();
    controls.addEventListener('change',()=>{renderer.render(scene,camera);window.__camera=camera.position.toArray();});
    const pixel = new Uint8Array(4); renderer.getContext().readPixels(200, 150, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixel);
    window.__pixel = Array.from(pixel); window.__painted = true;
    addEventListener('pagehide', () => { controls.dispose(); renderer.dispose(); });
  })().catch(error => { window.__sceneError = String(error); });
`;
const sandbox = `<Sandbox title="Three.js scene" height={300} html={${JSON.stringify('<canvas id="scene" width="400" height="300"></canvas>')}} script={${JSON.stringify(script)}} />`;
const doc = await create({ title: 'Three.js library gate', markup: sandbox });
const prose = await create({ markup: '<h1>Ordinary prose</h1>' });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const libraries = [];
  page.on('request', req => { if (req.url().includes('/libraries/')) libraries.push(req.url()); });
  await page.goto(`${base}/a/${prose.id}/raw`);
  assert.equal(libraries.length, 0, 'prose loads no optional library');
  await page.goto(`${base}/a/${doc.id}/raw`);
  const child = await (await page.waitForSelector('iframe[title="Three.js scene"]')).contentFrame();
  assert.equal(await page.locator('#scene').count(), 0, 'the canvas belongs only to the child');
  await child.waitForFunction(() => window.__painted || window.__sceneError, { timeout: 15000 });
  const state = await child.evaluate(() => ({ error: window.__sceneError, pixel: window.__pixel, same: window.__sameLibrary }));
  assert.equal(state.error, undefined, state.error);
  assert.equal(state.same, true);
  assert.ok(state.pixel[0] > state.pixel[1] * 2, `red model painted: ${state.pixel}`);
  assert.equal(libraries.length, 1, 'one on-demand library request');
  const beforeCamera=await child.evaluate(()=>JSON.stringify(window.__camera));
  const box=await child.locator('#scene').boundingBox();
  await page.mouse.move(box.x+200,box.y+150);await page.mouse.down();
  await page.mouse.move(box.x+245,box.y+160,{steps:5});await page.mouse.up();
  await child.waitForFunction(before=>JSON.stringify(window.__camera)!==before,beforeCamera);
  const blocked = await child.evaluate(async base => {
    const missing = await artifact.resolve('ref:Miss12').then(() => false, e => e.message === 'not found');
    const network = await fetch('https://example.com/exfil').then(() => false, () => true);
    let storage = false; try { localStorage.getItem('x'); } catch { storage = true; }
    let parentDom=false; try { parent.document.body.textContent; } catch { parentDom=true; }
    const account=await fetch(new URL('/api/my/artifacts',base).href).then(()=>false,()=>true);
    return { missing, network, storage, parentDom, account };
  },base);
  assert.deepEqual(blocked, { missing: true, network: true, storage: true, parentDom:true, account:true });
  const hydrated = await create({ markup: '<Card><CardContent>'+sandbox+'</CardContent></Card>' });
  await page.goto(`${base}/a/${hydrated.id}/raw`);
  const nested = await (await page.waitForSelector('iframe[title="Three.js scene"]')).contentFrame();
  await nested.waitForFunction(() => window.__painted || window.__sceneError, { timeout: 15000 });
  assert.equal(await nested.evaluate(() => window.__sceneError), undefined, 'API also works after hydration');
  assert.equal(await nested.evaluate(() => window.__painted), true);
  // Exercise the actual export service, not a screenshot after our own readiness wait.
  const exported = await fetch(`${base}/a/${doc.id}/export?format=png`);
  assert.equal(exported.status, 200, await exported.clone().text().then(t => t.slice(0, 100)));
  assert.ok(exported.headers.get('content-type')?.startsWith('image/png'));
  const { data, info } = await sharp(Buffer.from(await exported.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 100 && data[i] > data[i + 1] * 2 && data[i] > data[i + 2] * 2) red++;
  assert.ok(red > 100, 'export contains the rendered red model');
  console.log('ok: optional library, cached imports, textured GLB, WebGL pixels, CSP, missing refs, and PNG export');
} finally { await browser.close(); }
