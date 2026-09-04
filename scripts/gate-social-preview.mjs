/**
 * Editable social preview, end to end against a running server:
 * owner chrome → focused cropper → keyboard position/resize → source edit →
 * exact 1600×840 card → reset back to the top-left default.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const start = await startDocument(BASE);
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${start.token}` };
const markup = `<Helmet><title>Social preview gate</title><style>{\`
html,body{margin:0}.field{position:relative;width:1600px;height:1000px;background:rgb(51,204,51)}
.top{position:absolute;inset:0 0 auto 0;height:10px;background:rgb(204,51,51)}
.left{position:absolute;inset:0 auto 0 0;width:10px;background:rgb(51,51,204)}
\`}</style></Helmet><div className="field"><div className="top"></div><div className="left"></div></div>`;
const published = await fetch(`${BASE}/api/artifacts/${start.id}`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ markup }),
});
if (!published.ok) throw new Error(`seed failed: ${published.status} ${await published.text()}`);

const read = async () => {
  const res = await fetch(`${BASE}/api/artifacts/${start.id}`, { headers: auth });
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  return res.json();
};
const card = async () => {
  const res = await fetch(`${BASE}/a/${start.id}/export?mode=card&format=png`, { headers: auth });
  if (!res.ok) throw new Error(`card failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
};
const rgb = async (bytes, x, y) => {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return { size: { width: info.width, height: info.height }, color: [...data.subarray(at, at + 3)] };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
try {
  await becomeOwner(page, BASE, start.token);
  await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });
  await page.getByLabel('Open artifact controls').click();
  await page.getByLabel('Edit social preview').click();
  const dialog = page.getByRole('dialog', { name: 'Social preview' });
  await dialog.waitFor();
  await dialog.getByAltText('Artifact preview').waitFor({ state: 'visible', timeout: 30_000 });
  const frame = dialog.getByLabel('Move social preview crop');
  await frame.waitFor({ timeout: 30_000 });

  const handle = dialog.getByLabel('Resize social preview crop');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('resize handle has no layout box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 60, handleBox.y - 30);
  await page.mouse.up();
  check(Number(await handle.getAttribute('aria-valuenow')) < 1600, 'pointer resize changes the locked crop');

  const frameBox = await frame.boundingBox();
  if (!frameBox) throw new Error('crop frame has no layout box');
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await page.mouse.down();
  // Dragging pans the document: left/up reveals a region farther right/down.
  await page.mouse.move(frameBox.x + frameBox.width / 2 - 20, frameBox.y + frameBox.height / 2 - 12);
  await page.mouse.up();
  check(!String(await frame.getAttribute('aria-valuetext')).startsWith('x 0, y 0,'), 'pointer drag positions the crop');

  await dialog.getByLabel('Reset social preview').click();
  await dialog.getByLabel('Resize social preview crop').press('ArrowLeft');
  await frame.press('ArrowRight');
  await frame.press('ArrowDown');
  check((await frame.getAttribute('aria-valuetext')) === 'x 10, y 10, width 1580', 'keyboard resize and position update the locked crop');
  await dialog.getByText('save preview').click();
  await dialog.waitFor({ state: 'detached' });

  let stored = await read();
  check(stored.markup.includes('content="x=10;y=10;width=1580"'), 'save persists canonical {x,y,width} in Helmet');
  const selected = await rgb(await card(), 800, 5);
  check(JSON.stringify(selected.size) === JSON.stringify({ width: 1600, height: 840 }), 'saved card is exactly 1600×840');
  check(JSON.stringify(selected.color) === JSON.stringify([51, 204, 51]), `saved card uses the selected source region (${selected.color})`);

  // Reload to prove the frame is restored from persisted source, not dialog state.
  await page.reload({ waitUntil: 'load' });
  await page.getByLabel('Open artifact controls').click();
  await page.getByLabel('Edit social preview').click();
  const resetDialog = page.getByRole('dialog', { name: 'Social preview' });
  await resetDialog.getByLabel('Move social preview crop').waitFor({ timeout: 30_000 });
  await resetDialog.getByLabel('Reset social preview').click();
  await resetDialog.getByText('save preview').click();
  await resetDialog.waitFor({ state: 'detached' });
  stored = await read();
  check(!stored.markup.includes('artifactbin:og-crop'), 'reset removes the directive');
  const reset = await rgb(await card(), 800, 5);
  check(JSON.stringify(reset.color) === JSON.stringify([204, 51, 51]), `reset restores the top-left card (${reset.color})`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nsocial preview gate passed');
