import type { JsxNode, JsxElement } from '@/lib/jsx';

const expected = [['Core', 'email', 14.9], ['Core', 'chat', 3.1], ['Billing', 'email', 21.5], ['Billing', 'chat', 6.2]] as const;
const attr = (node: JsxElement, name: string) => {
  const value = node.attributes.find((a) => a.name === name)?.value;
  return value?.static ? value.json : undefined;
};

/** Checks a chart's bound results, not the existence of the word "median" or an unused correct query. */
export function juneResolutionCorrect(html: string): boolean {
  const text = /<script[^>]*id="mx-story-data"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!text) return false;
  try {
    const island = JSON.parse(text) as { nodes: JsxNode[]; dataflow?: { state?: { tables?: Record<string, { rows?: Record<string, unknown>[] }> } } };
    const tables = island.dataflow?.state?.tables ?? {};
    const visit = (nodes: JsxNode[]): boolean => nodes.some((node) => {
      if (node.type !== 'element') return false;
      if (node.tag === 'Question') {
        const data = attr(node, 'data'), viz = attr(node, 'viz');
        if (typeof data === 'string' && data.startsWith('$') && viz && typeof viz === 'object' && !Array.isArray(viz)) {
          const rows = tables[data.slice(1)]?.rows ?? [];
          if (['vega-lite', 'vega', 'recipe'].includes(String(viz.kind)) && rows.length === 4) {
            // A result column must carry all four actual June medians, keyed by team/channel.
            const keys = Object.keys(rows[0]);
            if (keys.some((key) => {
              if (!JSON.stringify(viz).includes(JSON.stringify(key))) return false;
              return expected.every(([team, channel, median]) => rows.some((row) => {
                const labels = Object.values(row).filter((v) => typeof v === 'string').join(' ').toLowerCase();
                return labels.includes(team.toLowerCase()) && labels.includes(channel) && typeof row[key] === 'number' && Math.abs((row[key] as number) - median) < 1e-6;
              }));
            })) return true;
          }
        }
      }
      return visit(node.children);
    });
    return Array.isArray(island.nodes) && visit(island.nodes);
  } catch { return false; }
}
