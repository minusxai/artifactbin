// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { STORY_TABLE_CSS } from "@/lib/page-styles/chrome-css";
import { AfDataTable, registerDataTable } from "./data-table";
registerDataTable();
afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-table-layout-test]").forEach((style) => style.remove());
});
it("keeps its virtual table in native table layout under document table styling", () => {
  const page = document.createElement("div");
  page.setAttribute("data-mx-story-root", "");
  const style = document.createElement("style");
  style.setAttribute("data-table-layout-test", "");
  style.textContent = STORY_TABLE_CSS;
  document.head.append(style);
  const el = document.createElement("af-data-table") as AfDataTable;
  el.data = {
    columns: [{ name: "id", type: "number" }],
    rows: [{ id: 1 }, { id: 2 }],
  };
  page.append(el);
  document.body.append(page);
  expect(getComputedStyle(el.querySelector("table")!).display).not.toBe("block");
});
it("retains keyed rows and controls while cycling sort with accessible buttons", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.setAttribute("label", "Sales");
  el.data = {
    columns: [
      { name: "id", type: "number" },
      { name: "value", type: "number" },
    ],
    rows: [
      { id: 2, value: 8 },
      { id: 1, value: 3 },
    ],
  };
  document.body.append(el);
  const row = el.querySelector("tbody tr[data-row-key]");
  const cell = row?.querySelector("td");
  const button = el.querySelector(
    'button[aria-label="Sort by value"]',
  ) as HTMLButtonElement;
  button.click();
  expect(el.querySelector("table")?.getAttribute("aria-label")).toBe("Sales");
  expect(el.querySelector("tbody tr[data-row-key]")?.textContent).toBe("13");
  expect(el.querySelectorAll("tbody tr[data-row-key]")[1]).toBe(row);
  expect(row?.querySelector("td")).toBe(cell);
  button.click();
  button.click();
  expect(el.sort).toBeNull();
});
it("renders bars, tint, custom cells and scoped edit intents", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.columns = [{ col: "n", bar: true, colorScale: "diverging", fmt: ".1f" }];
  el.data = {
    columns: [{ name: "n", type: "number" }],
    rows: [{ id: "a", n: 2 }],
  };
  document.body.append(el);
  expect(el.querySelector("[data-bar]")).toBeTruthy();
  expect(el.textContent).toContain("2.0");
  let detail: unknown;
  el.addEventListener(
    "af-edit-intent",
    (e) => (detail = (e as CustomEvent).detail),
  );
  el.cellRenderers = {
    n: (ctx) => {
      const b = document.createElement("button");
      b.textContent = "edit";
      b.onclick = () => ctx.edit(4);
      return b;
    },
  };
  (el.querySelector("tbody button") as HTMLButtonElement).click();
  expect(detail).toMatchObject({ key: "a", column: "n", value: 4 });
});
it("bounds large loaded results and recovers stable identities after scrolling", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.data = {
    columns: [{ name: "id", type: "number" }],
    rows: Array.from({ length: 10000 }, (_, id) => ({ id })),
  };
  document.body.append(el);
  const id = el.querySelector("td[data-column]")?.getAttribute("data-af-id");
  expect(el.querySelectorAll("tbody tr[data-row-key]").length).toBeLessThan(50);
  const scroll = el.querySelector("[data-slot=table-scroll]")!;
  scroll.scrollTop = 9000;
  scroll.dispatchEvent(new Event("scroll"));
  scroll.scrollTop = 0;
  scroll.dispatchEvent(new Event("scroll"));
  expect(el.querySelector("td[data-column]")?.getAttribute("data-af-id")).toBe(
    id,
  );
});
it("keeps focus while sorting a custom control and refreshed keyed rows", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.cellRenderers = {
    id: (_ctx, cell) => {
      if (!cell.firstChild) return document.createElement("input");
    },
  };
  el.data = {
    columns: [{ name: "id", type: "number" }],
    rows: [{ id: 2 }, { id: 1 }],
  };
  document.body.append(el);
  const input = el.querySelector("input")!;
  input.focus();
  el.sort = { col: "id", dir: "asc" };
  expect(document.activeElement).toBe(input);
  el.data = { ...el.data, rows: [{ id: 2 }, { id: 1 }] };
  expect(el.querySelectorAll("input")[1]).toBe(input);
});
it("scopes template ids, labels and data identities per typed row key", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  const template = document.createElement("template");
  template.innerHTML =
    '<label for="field" data-af-id="label">Value</label><input id="field" data-af-id="field"><span data-field="name"></span>';
  el.templates = [{ col: "name", template }];
  el.data = {
    columns: [{ name: "name", type: "string" }],
    rows: [
      { id: 1, name: "One" },
      { id: "1", name: "Two" },
    ],
  };
  document.body.append(el);
  const inputs = el.querySelectorAll("input");
  expect(inputs[0]!.id).not.toBe(inputs[1]!.id);
  expect(el.querySelector("label")!.htmlFor).toBe(inputs[0]!.id);
  expect(inputs[0]!.getAttribute("data-af-id")).not.toBe(
    inputs[1]!.getAttribute("data-af-id"),
  );
  expect(el.textContent).toContain("One");
});
it("renders comparison best values, ranks, sublines and edges", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.transpose = true;
  el.header = "name";
  el.edge = true;
  el.metrics = [
    { col: "score", title: "Score", better: "high", rank: "rank", sub: "note" },
  ];
  el.data = {
    columns: [
      { name: "name", type: "string" },
      { name: "score", type: "number" },
    ],
    rows: [
      { name: "A", score: 4, rank: 1, note: "top" },
      { name: "B", score: 2 },
    ],
  };
  document.body.append(el);
  expect(el.querySelector("tbody strong")?.textContent).toBe("4");
  expect(el.textContent).toContain("#1");
  expect(el.textContent).toContain("top");
  expect(el.textContent).toContain("A by 100%");
});
it("ignores source replies after replacement or disconnect, and displays retryable failures", async () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  document.body.append(el);
  let resolve!: (value: typeof el.data) => void;
  let signal!: AbortSignal;
  el.source = {
    read: (request) => {
      signal = request.signal;
      return new Promise((r) => (resolve = r));
    },
  };
  const request = el.loadMore();
  expect(el.querySelector("table")?.getAttribute("aria-busy")).toBe("true");
  el.data = { columns: [{ name: "id", type: "number" }], rows: [{ id: 8 }] };
  resolve({ columns: [], rows: [{ id: 9 }] });
  await request;
  expect(signal.aborted).toBe(true);
  expect(el.textContent).toContain("8");
  expect(el.textContent).not.toContain("9");
  el.source = {
    read: async () => {
      throw new Error("Unavailable");
    },
  };
  await vi.waitFor(() =>
    expect(el.querySelector("[role=alert]")?.textContent).toBe("Unavailable"),
  );
  el.source = {
    read: (request) => {
      signal = request.signal;
      return new Promise((r) => (resolve = r));
    },
  };
  const detached = el.loadMore();
  el.remove();
  expect(signal.aborted).toBe(true);
  resolve({ columns: [], rows: [] });
  await detached;
});
it("renders repeated unkeyed row objects as separate rows", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  const row = { n: 1 };
  el.data = { columns: [{ name: "n", type: "number" }], rows: [row, row] };
  document.body.append(el);
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(2);
});
it("loads a newly assigned source and replaces prior source rows from offset zero", async () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  document.body.append(el);
  const first = vi.fn(async (_request: unknown) => ({
    columns: [{ name: "id", type: "number" as const }],
    rows: [{ id: 1 }],
    totalRows: 2,
    truncated: true,
  }));
  el.source = { read: first };
  await vi.waitFor(() => expect(el.data.rows).toEqual([{ id: 1 }]));
  expect(first.mock.calls[0]?.[0]).toMatchObject({ offset: 0 });
  const next = vi.fn(async (_request: unknown) => ({
    columns: [{ name: "id", type: "number" as const }],
    rows: [{ id: 8 }],
    totalRows: 1,
  }));
  el.source = { read: next };
  await vi.waitFor(() => expect(el.data.rows).toEqual([{ id: 8 }]));
  expect(next.mock.calls[0]?.[0]).toMatchObject({ offset: 0 });
  expect(el.textContent).not.toContain("1 of 2");
});
it("cleans semantic headers and body when switching comparison and grid layouts", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.transpose = true;
  el.header = "name";
  el.data = {
    columns: [
      { name: "name", type: "string" },
      { name: "n", type: "number" },
    ],
    rows: [
      { name: "One", n: 1 },
      { name: "Two", n: 2 },
    ],
  };
  document.body.append(el);
  const table = el.querySelector("table")!;
  expect(el.querySelectorAll("thead th")).toHaveLength(3);
  expect(el.querySelectorAll("tbody tr")).toHaveLength(1);
  el.transpose = false;
  expect(el.querySelectorAll("thead th")).toHaveLength(2);
  expect(el.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(table.getAttribute("aria-rowcount")).toBe("3");
  el.transpose = true;
  expect(el.querySelectorAll("thead th")).toHaveLength(3);
  expect(el.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(table.getAttribute("aria-rowcount")).toBe("2");
  expect(table.getAttribute("aria-colcount")).toBe("3");
});
it("resets viewport after result shrink and sort without blanking loaded rows", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.data = {
    columns: [{ name: "id", type: "number" }],
    rows: Array.from({ length: 1000 }, (_, id) => ({ id })),
  };
  document.body.append(el);
  const viewport = el.querySelector("[data-slot=table-scroll]")!;
  viewport.scrollTop = 30000;
  viewport.dispatchEvent(new Event("scroll"));
  el.data = { ...el.data, rows: [{ id: 3 }, { id: 1 }] };
  expect(viewport.scrollTop).toBe(0);
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(2);
  viewport.scrollTop = 1000;
  el.sort = { col: "id", dir: "asc" };
  expect(viewport.scrollTop).toBe(0);
  expect(el.querySelector("tbody tr[data-row-key]")?.textContent).toBe("1");
});
