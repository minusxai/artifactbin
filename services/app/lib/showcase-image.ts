import { SHOWCASE, showcaseCardUrl } from "./showcase";
/** Same-origin WebGL textures, restricted to the curated public showcase.
 * Never forwards a viewer credential, follows redirects, or accepts a URL.
 */
export async function showcaseImage(id: string): Promise<Response> {
  const doc = SHOWCASE.find((item) => item.id === id);
  if (!doc) return new Response(null, { status: 404 });
  try {
    const upstream = await fetch(showcaseCardUrl(doc), {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (
      !upstream.ok ||
      !upstream.headers.get("content-type")?.startsWith("image/jpeg")
    ) {
      await upstream.body?.cancel();
      return new Response(null, { status: 502 });
    }
    const reader = upstream.body?.getReader();
    if (!reader) return new Response(null, { status: 502 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        return new Response(null, { status: 502 });
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
