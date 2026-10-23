import type {
  HistoricalDatasetReplay,
  HistoricalDatasetReplayPorts,
} from "./history-contracts.ts";
const escape = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const unavailable =
  '<p role="status">Archived dataset rows are unavailable. Current data has not been substituted.</p>';
/** Inert HTML only. The enclosing saved-view renderer retains its empty sandbox and CSP. */
export function createHistoricalDatasetReplay(
  ports: HistoricalDatasetReplayPorts,
): HistoricalDatasetReplay {
  return {
    async render(pageId, version, subject) {
      const selected = await ports.resolve(pageId, version, subject);
      if (!selected) return null;
      const notice = `<h1>Archived dataset version ${version}</h1><p role="status">Read-only archived data. Table previews show at most 100 rows each.</p>`;
      try {
        if (selected.kind === "unavailable") throw Error();
        if (
          selected.version !== version ||
          selected.context.pageId !== pageId ||
          selected.context.subject !== subject ||
          selected.tables.length > 8
        )
          throw Error();
        const tables: string[] = [];
        let bytes = 0;
        for (const table of selected.tables) {
          const data = await ports.read(selected, table);
          if (
            data.version !== version ||
            data.schema !== table.schema ||
            data.table !== table.name ||
            data.offset !== 0 ||
            data.rows.length > 100 ||
            data.totalRows < data.rows.length
          )
            throw Error();
          const html = `<section><h2>${escape(table.schema)}.${escape(table.name)}</h2><p>${data.totalRows ? `Showing ${data.rows.length} of ${data.totalRows} rows` : "No rows"}</p><div style="overflow:auto"><table><thead><tr>${data.columns.map((c) => `<th scope="col">${escape(c.name)}</th>`).join("")}</tr></thead><tbody>${data.rows.map((row) => `<tr>${data.columns.map((c) => `<td>${escape(row[c.name])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
          bytes += Buffer.byteLength(html);
          if (bytes > 180000) throw Error();
          tables.push(html);
        }
        return `<!doctype html><html><head><style>body{font:1rem/1.5 system-ui;padding:2rem}table{border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:.5rem;text-align:left;overflow-wrap:anywhere;max-width:30rem}</style></head><body>${notice}${tables.join("")}</body></html>`;
      } catch {
        return `<!doctype html><html><body>${notice}${unavailable}</body></html>`;
      }
    },
  };
}
