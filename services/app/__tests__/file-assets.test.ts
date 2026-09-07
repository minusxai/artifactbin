import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/artifacts/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { mintToken } from '@/lib/tokens';
import { getArtifactById } from '@/lib/artifacts';
import { assetBytesForToken } from '@/lib/asset-quota';
import { useAppHarness } from './harness';

useAppHarness();
const base = 'http://localhost:3000';
const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0, 255, 42]);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function upload(query = '', contentType = 'model/gltf-binary', body = bytes, filename = 'scene.glb') {
  const token = await mintToken('files');
  const response = await POST(new Request(`${base}/api/artifacts?format=file&filename=${encodeURIComponent(filename)}${query}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': contentType }, body,
  }));
  return { response, token };
}

describe('generic file artifacts', () => {
  it('uploads exact bytes, keeps metadata, charges quota, and serves a safe download', async () => {
    const { response, token } = await upload();
    expect(response.status).toBe(201);
    const file = await response.json();
    expect(file.format).toBe('file');
    expect(file.rawUrl).toContain(`/a/${file.id}/raw`);
    expect((await getArtifactById(file.id))?.meta).toMatchObject({ filename: 'scene.glb', bytes: bytes.length, contentType: 'model/gltf-binary' });
    expect(await assetBytesForToken(token.id)).toBe(bytes.length);
    const download = await raw(new Request(`${base}/a/${file.id}/raw`), ctx(file.id));
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(download.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  it('uses the extension MIME type, preserving bytes as an inert download', async () => {
    const { response } = await upload('', 'text/html', new TextEncoder().encode('<script>alert(1)</script>'));
    expect(response.status).toBe(201);
    const file = await response.json();
    const res = await raw(new Request(`${base}/a/${file.id}/raw`), ctx(file.id));
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(res.headers.get('content-disposition')).toContain('attachment;');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each(['page.html', 'script.js', 'program.exe', 'archive.tar', 'clip.mp4.exe', 'README', '.mp3', 'song.mp3.'])('rejects unsupported raw upload %s before storing it', async filename => {
    const { response, token } = await upload('', 'application/octet-stream', bytes, filename);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unsupported_file_type', allowed: expect.arrayContaining(['mp4', 'mp3', 'mov', 'glb']) });
    expect(await assetBytesForToken(token.id)).toBe(0);
  });

  it.each([['clip.MP4', 'video/mp4'], ['song.mp3', 'audio/mpeg'], ['clip.mov', 'video/quicktime'], ['model.GLB', 'model/gltf-binary'], ['archive.zip', 'application/zip']])('accepts %s with a canonical MIME type', async (filename, contentType) => {
    const { response } = await upload('', 'application/octet-stream', bytes, filename);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ filename, contentType });
  });

  it('rejects unsupported files through JSON/MCP too', async () => {
    const token = await mintToken('unsupported-json-file');
    const res = await POST(new Request(`${base}/api/artifacts`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: { filename: 'program.exe', contentType: 'application/octet-stream', base64: Buffer.from(bytes).toString('base64') } }),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unsupported_file_type' });
    expect(await assetBytesForToken(token.id)).toBe(0);
  });

  it('accepts the JSON file envelope used by agent tools', async () => {
    const token = await mintToken('json-file');
    const res = await POST(new Request(`${base}/api/artifacts`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: { filename: 'scene.glb', contentType: 'model/gltf-binary', base64: Buffer.from(bytes).toString('base64') } }),
    }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ format: 'file', filename: 'scene.glb', bytes: bytes.length });
  });

  it('bounds a chunked upload and refuses invalid filenames', async () => {
    expect((await upload('', 'application/octet-stream', new Uint8Array(10001))).response.status).toBe(413);
    const token = await mintToken('bad-name');
    const res = await POST(new Request(`${base}/api/artifacts?format=file&filename=../scene.glb`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.token}` }, body: bytes,
    }));
    expect(res.status).toBe(400);
  });
});
