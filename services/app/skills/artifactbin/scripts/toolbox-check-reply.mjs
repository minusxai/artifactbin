/**
 * Internal: what check.mjs reads from the page itself: its source first (deck viewports, a warm
 * dataset cache), then for a clean pass the facts its Reply block states beyond the run: the page
 * link, the starter's "Built with:" comment and who can do what in each linked dataset (the
 * server's permission read-back, verbatim).
 * Used by: toolbox-check-command.mjs, toolbox-check-digest.mjs, author-toolbox tests.
 */
/** Deck viewports: a page with slides checked without --viewport gets these. */
export const DECK_VIEWPORTS = ['1200x630', '1280x800'];
export const PAGE_VIEWPORTS = ['1280x800', '390x844'];
export const isDeck = html => /\bdata-af-slide\b/.test(html ?? '');

/** The page's "Built with:" comment (a starter header), as one line, or null. Continuation lines
 * are the indented comment lines right below it. */
export function builtWith(html) {
  const lines = String(html ?? '').split('\n'), at = lines.findIndex(l => /Built with:/.test(l));
  if (at < 0) return null;
  const parts = [lines[at].slice(lines[at].indexOf('Built with:') + 11)];
  for (const line of lines.slice(at + 1)) {
    if (/-->|\*\//.test(parts.at(-1)) || !/^\s*(?:\/\/|\*)?\s{2,}\S/.test(line)) break;
    parts.push(line.replace(/^\s*(?:\/\/|\*)?/, ''));
  }
  const text = parts.join(' ').replace(/-->[\s\S]*|\*\/[\s\S]*/, '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** Each <link rel="af-dataset" href="ref:ID" data-af-name="NAME"> of the page. */
export function datasetLinks(html) {
  return [...String(html ?? '').matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    if (!/\brel\s*=\s*["'][^"']*\baf-dataset\b/i.test(tag)) return [];
    const id = /\bhref\s*=\s*["']ref:([A-Za-z0-9]{6,12})["']/i.exec(tag)?.[1];
    const name = /\bdata-af-name\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    return id ? [{id, name: name ?? id}] : [];
  });
}

/** The linked datasets the page never read: every viewport measured its reads (load and steps)
 * and none saw one. Unmeasured or unknown (no source) never fails. */
export function unreadDatasets(html, checks) {
  const measured = (checks ?? []).filter(c => c?.viewport && typeof c.datasetReads === 'number');
  return measured.length && measured.every(c => c.datasetReads === 0) ? datasetLinks(html) : [];
}

/** The page source (null after 5 s or on failure); the linked datasets are read too within the
 * same 5 s, so the first hosted run does not meet a cold start. Never fails the check. */
export async function pageSource(client, id) {
  const late = new Promise(resolve => setTimeout(() => resolve(null), 5000).unref?.());
  const html = await Promise.race([
    client.request(`/a/${id}/raw`, {raw: true}).then(response => response.text()),
    late
  ]).catch(() => null);
  if (html) await Promise.race([Promise.allSettled(datasetLinks(html).map(link =>
    client.request('/api/artifacts/' + link.id))), late]);
  return html;
}

/** The facts of a clean pass's Reply block: link, Built with, and the permission read-back of
 * every linked dataset that has a stored policy (one you cannot read is left out). */
export async function replyFacts(client, server, id, html) {
  const permissions = (await Promise.all(datasetLinks(html).map(async link => {
    const read = await client.request(`/api/artifacts/${link.id}/policy`).catch(() => null);
    const lines = String(read?.readBack ?? '').split('\n').filter(Boolean);
    return read?.source === 'v3' && lines.length ? [{...link, lines}] : [];
  }))).flat();
  const built = builtWith(html);
  return {id, link: `${server}/a/${id}`, ...(built ? {builtWith: built} : {}), permissions};
}
