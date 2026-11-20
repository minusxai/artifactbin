// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SQL_FAILURES } from "@artifactbin/contracts/sql-failures";
import { STORY_TABLE_CSS } from "@/lib/page-styles";
import { AfDataTable } from "./data-table";
import './data-table';
import { measuredTableWindow } from "./table-model";
import { pageSqlRuntime } from "./page-sql";
/** A condition wait's bound (vi.waitFor's own default is 1 s): the condition decides; this only names one that never came. */
const WAIT_MS = 20_000;
/**
 * Resize notifications re-render on the next animation frame, never inside the observer callback. Frames are held:
 * `nextFrame()` runs every callback queued so far, as one frame, instead of waiting on the environment's frame timer.
 */
let frames = new Map<number, FrameRequestCallback>(), frameIds = 0;
beforeEach(() => {
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameIds, callback); return frameIds; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
});
const nextFrame = async () => {
  await Promise.resolve();
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(performance.now());
};
it("preserves caller column header identities through sorting and removes stale mappings", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.columnIdentities = { value: { afId: "source-column", id: "authored-column" } };
  el.data = { columns: [{ name: "value", type: "number" }], rows: [{ value: 2 }, { value: 1 }] };
  document.body.append(el);
  const header = el.querySelector("th")!;
  expect(header.id).toBe("authored-column");
  expect(header.getAttribute("data-af-id")).toBe("source-column");
  header.click();
  expect(el.querySelector("th")).toBe(header);
  expect(header.getAttribute("data-af-id")).toBe("source-column");
  el.columnIdentities = {};
  expect(header.hasAttribute("id")).toBe(false);
  expect(header.hasAttribute("data-af-id")).toBe(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-table-layout-test]").forEach((style) => style.remove());
});
it("measures columns after detached initialization and remeasures changed row content", async () => {
  let widths = [180, 96];
  vi.spyOn(HTMLTableCellElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLTableCellElement) {
    const width = this.isConnected ? widths[this.cellIndex] ?? 0 : 0;
    return { width, height: 20, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 20, toJSON() {} };
  });
  const el = document.createElement("af-data-table") as AfDataTable;
  const columns = [{name: "person", type: "string" as const}, {name: "amount", type: "number" as const}];
  el.data = {columns, rows: []};
  await Promise.resolve();
  document.body.append(el);
  await Promise.resolve();
  expect(el.querySelector("thead tr")!.getAttribute("style")).toContain("minmax(180px, 1fr) minmax(96px, 1fr)");
  widths = [249, 113];
  el.data = {columns, rows: [{person: "A longer resolved person", amount: 12}]};
  await Promise.resolve();
  const header = el.querySelector<HTMLElement>("thead tr")!;
  const row = el.querySelector<HTMLElement>("tbody tr[data-row-key]")!;
  expect(header.style.gridTemplateColumns).toBe("minmax(249px, 1fr) minmax(113px, 1fr)");
  expect(row.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns);
  widths = [210, 101];
  el.data = {columns, rows: [{person: "Changed", amount: 13}]};
  widths = [230, 105];
  el.data = {columns, rows: [{person: "Latest", amount: 14}]};
  await Promise.resolve();
  expect(el.querySelector("tbody tr[data-row-key]")).toBe(row);
  expect(header.style.gridTemplateColumns).toBe("minmax(230px, 1fr) minmax(105px, 1fr)");
  expect(row.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns);
});
it("remeasures its columns once shown after a hidden first draw, when a sort mark widens a header and when a font swaps in", async () => {
  const resized: ResizeObserverCallback[] = [];
  vi.stubGlobal("ResizeObserver", class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { resized.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  const fonts = new EventTarget();
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  // Hidden (a closed tab, a collapsed section): every header measures 0 wide.
  let widths = [0, 0];
  vi.spyOn(HTMLTableCellElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLTableCellElement) {
    const width = widths[this.cellIndex] ?? 0;
    return { width, height: 20, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 20, toJSON() {} };
  });
  const el = document.createElement("af-data-table") as AfDataTable;
  document.body.append(el);
  el.data = { columns: [{ name: "Churn rate (monthly)", type: "number" }, { name: "n", type: "number" }], rows: [{ "Churn rate (monthly)": 0.03, n: 1 }] };
  await Promise.resolve();
  const header = el.querySelector<HTMLElement>("thead tr")!;
  expect(header.style.gridTemplateColumns).toBe("minmax(0, 1fr) minmax(0, 1fr)");
  // Shown: its scroll box resizes, and the columns are measured at their natural widths.
  widths = [174, 40];
  for (const callback of resized) callback([], {} as ResizeObserver);
  await nextFrame();
  expect(header.style.gridTemplateColumns).toBe("minmax(174px, 1fr) minmax(40px, 1fr)");
  // Sorting adds a mark to the header after it was measured: measured again, with the mark.
  widths = [190, 40];
  el.querySelector<HTMLElement>("th")!.click();
  expect(header.style.gridTemplateColumns).toBe("minmax(190px, 1fr) minmax(40px, 1fr)");
  expect(el.querySelector<HTMLElement>("tbody tr[data-row-key]")!.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns);
  // A web font swapping in widens every header: measured again on the next frame.
  widths = [230, 52];
  fonts.dispatchEvent(new Event("loadingdone"));
  await nextFrame();
  expect(header.style.gridTemplateColumns).toBe("minmax(230px, 1fr) minmax(52px, 1fr)");
  el.remove();
  widths = [300, 60];
  fonts.dispatchEvent(new Event("loadingdone"));
  await nextFrame();
  expect(header.style.gridTemplateColumns).toBe("minmax(230px, 1fr) minmax(52px, 1fr)");
  delete (document as { fonts?: unknown }).fonts;
});
it("retains a focused row beyond the initial sample while refreshing column measurements", async () => {
  const observers: MeasuredRows[] = [];
  class MeasuredRows implements ResizeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    flush() { this.callback([...this.targets].map(target => ({target,borderBoxSize:[{blockSize:43}],contentRect:{height:43}}) as unknown as ResizeObserverEntry), this); }
  }
  vi.stubGlobal("ResizeObserver", MeasuredRows);
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.cellRenderers = {value(context, cell) {
    if (!cell.firstChild) { const input = document.createElement("input"); input.value = String(context.row.value); cell.append(input); }
  }};
  const columns = [{name:"id",type:"number" as const},{name:"value",type:"string" as const}];
  const rows = Array.from({length:200}, (_,id)=>({id,value:`Row ${id}`}));
  el.data = {columns,rows}; document.body.append(el); await Promise.resolve();
  observers.at(-1)!.flush();
  const viewport = el.querySelector<HTMLElement>("[data-slot=table-scroll]")!;
  viewport.scrollTop = 100 * 43; viewport.dispatchEvent(new Event("scroll"));
  observers.at(-1)!.flush();
  const input = el.querySelector<HTMLInputElement>('tbody tr[data-row-key] input')!;
  const rowIndex = Number(input.closest("tr")!.getAttribute("aria-rowindex"));
  expect(rowIndex).toBeGreaterThan(52);
  expect(input).toBeTruthy(); input.focus();
  const scroll = viewport.scrollTop;
  el.data = {columns,rows:rows.map(row=>({...row}))};
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(viewport.scrollTop).toBe(scroll);
  await Promise.resolve();
  expect(el.querySelector(`tr[aria-rowindex="${rowIndex}"] input`)).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(viewport.scrollTop).toBe(scroll);
});
it("uses a shared measured grid for its virtual header and body rows", async () => {
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
  await Promise.resolve();
  const table = el.querySelector("table")!;
  const header = table.tHead!.rows[0]!;
  const row = table.tBodies[0]!.querySelector<HTMLTableRowElement>("tr[data-row-key]")!;
  expect(getComputedStyle(table).display).toBe("block");
  expect(getComputedStyle(header).display).toBe("grid");
  expect(getComputedStyle(row).display).toBe("grid");
  expect(row.style.position).toBe("absolute");
  expect(row.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns);
});
it("uses measured row heights when selecting and positioning a virtual window", () => {
  const layout = measuredTableWindow([43, 43, 44, 43, 43], 44, 86, 1);
  expect(layout.offsets).toEqual([0, 43, 86, 130, 173]);
  expect(layout.total).toBe(216);
  expect(layout.start).toBe(0);
  expect(layout.end).toBe(4);
});
it("remeasures changed columns and restores virtual grid layout after comparison mode", async () => {
  const tableDisplaysAtMeasurement: string[] = [];
  const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.tagName === "TH") tableDisplaysAtMeasurement.push(getComputedStyle(this.closest("table")!).display);
    const width = this.textContent === "id" ? 48 : this.textContent === "value" ? 112 : 80;
    return { width, height: 20, top: 0, right: width, bottom: 20, left: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
  const el = document.createElement("af-data-table") as AfDataTable;
  el.data = {
    columns: [{ name: "id", type: "number" }, { name: "value", type: "number" }],
    rows: Array.from({ length: 60 }, (_, id) => ({ id, value: id * 2 })),
  };
  document.body.append(el);
  await Promise.resolve();
  expect(el.querySelector<HTMLTableRowElement>("thead tr")?.style.gridTemplateColumns).toContain("48px");

  el.columns = [{ col: "value", width: 112 }];
  await Promise.resolve();
  expect(el.querySelector<HTMLTableRowElement>("thead tr")?.style.gridTemplateColumns).toContain("112px");
  expect(tableDisplaysAtMeasurement.length).toBeGreaterThanOrEqual(2);
  expect(tableDisplaysAtMeasurement.every((display) => display === "table")).toBe(true);

  el.transpose = true;
  expect(el.querySelector<HTMLTableElement>("table")?.style.display).toBe("");
  el.transpose = false;
  expect(el.querySelector<HTMLTableElement>("table")?.style.display).toBe("block");
  rectSpy.mockRestore();
});
it("keeps component-owned table cells classed, so bare-text page defaults never match them", () => {
  // Pages from the retired story renderer style only class-less elements (document-serving legacy-story-typography test).
  const el = document.createElement("af-data-table") as AfDataTable;
  el.data = {
    columns: [{ name: "value", type: "number" }],
    rows: [{ value: 1 }],
  };
  document.body.append(el);
  expect(el.querySelector("table")!.hasAttribute("class")).toBe(true);
  expect(el.querySelector("thead th")!.hasAttribute("class")).toBe(true);
  expect(el.querySelector("tbody td[data-column]")!.hasAttribute("class")).toBe(true);
});
it("fills a GridItem without turning standalone height into a forced fill", () => {
  const gridItem = document.createElement("div");
  gridItem.className = "native-grid-item";
  gridItem.style.height = "172px";
  const filled = document.createElement("af-data-table") as AfDataTable;
  filled.setAttribute("data-af-fill", "");
  filled.height = 166;
  const standalone = document.createElement("af-data-table") as AfDataTable;
  standalone.height = 166;
  gridItem.append(filled);
  document.body.append(gridItem, standalone);

  expect(getComputedStyle(filled).height).toBe("100%");
  expect(getComputedStyle(filled.querySelector("[data-slot=table-scroll]")!).flexGrow).toBe("1");
  expect(getComputedStyle(standalone).height).not.toBe("100%");
  expect(standalone.getAttribute("height")).toBe("166");
});
it("windows rows against the measured scroll viewport and refreshes after resize", async () => {
  const onResize: ResizeObserverCallback[] = [];
  let disconnected = false;
  class TestResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      onResize.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      disconnected = true;
    }
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);

  const el = document.createElement("af-data-table") as AfDataTable;
  el.height = 420;
  el.data = {
    columns: [{ name: "value", type: "number" }],
    rows: Array.from({ length: 100 }, (_, value) => ({ value })),
  };
  document.body.append(el);
  await Promise.resolve();
  const viewport = el.querySelector("[data-slot=table-scroll]")!;
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: 33,
  });
  onResize[0]?.([], {} as ResizeObserver);
  await nextFrame();

  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(13);
  el.remove();
  expect(disconnected).toBe(true);
});
it("retains keyed rows and controls while cycling sort with accessible column headers", () => {
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
  const header = el.querySelector(
    'th[aria-label="Sort by value"]',
  ) as HTMLTableCellElement;
  header.click();
  expect(el.querySelector("table")?.getAttribute("aria-label")).toBe("Sales");
  expect(el.querySelector("tbody tr[data-row-key]")?.textContent).toBe("13");
  expect(el.querySelectorAll("tbody tr[data-row-key]")[1]).toBe(row);
  expect(row?.querySelector("td")).toBe(cell);
  header.click();
  header.click();
  expect(el.sort).toBeNull();
});
it("renders bars, custom cells and scoped edit intents", () => {
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
it("keeps the bar overlay out of table-cell layout", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.columns = [{ col: "n", bar: true }];
  el.data = {
    columns: [{ name: "n", type: "number" }],
    rows: [{ n: 2 }],
  };
  document.body.append(el);

  const cell = el.querySelector("tbody td")!;
  const bar = cell.querySelector("[data-bar]")!;
  expect(cell.hasAttribute("data-bar")).toBe(false);
  expect(getComputedStyle(cell).position).not.toBe("absolute");
  expect(getComputedStyle(bar).position).toBe("absolute");
});
it("sorts from its single accessible column header with mouse, Enter and Space", () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.data = {
    columns: [
      { name: "name", type: "string" },
      { name: "score", type: "number" },
    ],
    rows: [
      { name: "Ada", score: 92 },
      { name: "Grace", score: 98 },
      { name: "Linus", score: 85 },
    ],
  };
  document.body.append(el);

  const header = el.querySelector<HTMLTableCellElement>('th[aria-label="Sort by score"]')!;
  expect(header.querySelector("button")).toBeNull();
  expect(header.tabIndex).toBe(0);
  const changes: unknown[] = [];
  el.addEventListener("af-sort-change", (event) => {
    changes.push((event as CustomEvent).detail);
  });

  header.click();
  expect(el.sort).toEqual({ col: "score", dir: "asc" });
  expect(header.getAttribute("aria-sort")).toBe("ascending");
  expect(changes).toEqual([{ col: "score", dir: "asc" }]);

  header.focus();
  const enter = new KeyboardEvent("keydown", {key:"Enter",bubbles:true,cancelable:true});
  header.dispatchEvent(enter);
  expect(enter.defaultPrevented).toBe(true);
  expect(el.sort).toEqual({ col: "score", dir: "desc" });
  expect(header.getAttribute("aria-sort")).toBe("descending");
  expect(changes).toEqual([
    { col: "score", dir: "asc" },
    { col: "score", dir: "desc" },
  ]);
  expect(document.activeElement).toBe(header);
  const space = new KeyboardEvent("keydown", {key:" ",bubbles:true,cancelable:true});
  header.dispatchEvent(space);
  expect(space.defaultPrevented).toBe(true);
  expect(el.sort).toBeNull();
  expect(header.getAttribute("aria-sort")).toBe("none");
  header.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown",bubbles:true}));
  expect(el.sort).toBeNull();
  expect(changes).toHaveLength(3);
  expect(header.getAttribute("aria-label")).toBe("Sort by score");
  expect(header.scope).toBe("col");
});
it("keeps the grouped row count after the final page without more requests", async () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  const columns = [{ name: "id", type: "number" as const }];
  const rows = Array.from({ length: 1001 }, (_, id) => ({ id: id + 1 }));
  let reads = 0;
  el.source = {
    async read({ offset, limit }) {
      reads++;
      return {
        columns,
        rows: rows.slice(offset, offset + limit),
        totalRows: rows.length,
        truncated: offset + limit < rows.length,
      };
    },
  };
  el.data = {
    columns,
    rows: rows.slice(0, 1000),
    totalRows: rows.length,
    truncated: true,
  };
  document.body.append(el);

  const initialButton = el.querySelector<HTMLButtonElement>(
    'button[aria-label="Load more rows"]',
  )!;
  expect(getComputedStyle(initialButton).borderStyle).toBe("none");
  expect(getComputedStyle(initialButton).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(initialButton).cursor).toBe("pointer");
  expect(initialButton.style.getPropertyValue("font-weight")).toBe("500");
  initialButton.click();
  await vi.waitFor(() => expect(el.data.rows.at(-1)?.id).toBe(1001), { timeout: WAIT_MS });

  const footer = el.querySelector<HTMLDivElement>("[data-slot=table-footer]")!;
  const rowCount = footer.querySelector('[aria-label="Row count"]');
  expect(el.data.rows.at(-1)?.id).toBe(1001);
  expect(el.data.truncated).toBe(false);
  expect(rowCount?.textContent).toBe("1,001 of 1,001 rows");
  expect(getComputedStyle(rowCount!).lineHeight).toBe("16px");
  expect(
    footer.querySelector('button[aria-label="Load more rows"]'),
  ).toBeNull();
  expect(reads).toBe(1);
  await el.loadMore();
  expect(reads).toBe(1);
});
it("bounds large loaded results and recovers stable identities after scrolling", async () => {
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.data = {
    columns: [{ name: "id", type: "number" }],
    rows: Array.from({ length: 10000 }, (_, id) => ({ id })),
  };
  document.body.append(el);
  await Promise.resolve();
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

it("keeps authored header typography on the named column header without duplicate sorting controls", () => {
  const style=document.createElement("style");style.setAttribute("data-table-layout-test","");style.textContent='af-data-table thead th{text-transform:uppercase} button{text-transform:none}';document.head.append(style);
  const el=document.createElement("af-data-table") as AfDataTable;
  el.columns=[{col:"day",title:"Day"},{col:"time",title:"Time"},{col:"action",title:""}];
  el.data={columns:[{name:"day",type:"string"},{name:"time",type:"string"},{name:"action",type:"string"}],rows:[]};document.body.append(el);
  const heads=[...el.querySelectorAll("thead th")];
  expect(heads.map(header=>header.textContent)).toEqual(["Day","Time",""]);
  expect(heads.map(header=>header.getAttribute("aria-label"))).toEqual(["Sort by Day","Sort by Time","Sort by "]);
  expect(el.querySelectorAll("thead button")).toHaveLength(0);
  expect(heads.every(header=>getComputedStyle(header).textTransform==="uppercase")).toBe(true);
});

it("remeasures retained keyed rows after data replacement and subsequent viewport resize", async () => {
  const observers: ObservedResizeObserver[] = [];
  let rowHeight = 43;
  class ObservedResizeObserver implements ResizeObserver {
    targets = new Set<Element>();
    pending = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { if (!this.targets.has(target)) this.pending.add(target); this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); this.pending.delete(target); }
    disconnect() { this.targets.clear(); this.pending.clear(); }
    flush() {
      const entries = [...this.pending].map(target => ({ target, borderBoxSize: [{blockSize: rowHeight}], contentRect: {height: rowHeight} }) as unknown as ResizeObserverEntry);
      this.pending.clear(); this.callback(entries, this);
    }
  }
  vi.stubGlobal("ResizeObserver", ObservedResizeObserver);
  const el = document.createElement("af-data-table") as AfDataTable;
  el.rowKey = "id";
  el.height = 420;
  const data = {columns: [{name: "id", type: "number" as const}], rows: Array.from({length: 100}, (_, id) => ({id}))};
  el.data = data; document.body.append(el); await Promise.resolve();
  const rowObserver = observers.at(-1)!;
  rowObserver.flush(); await nextFrame();
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(22);
  const retained = el.querySelector("tbody tr[data-row-key]");
  el.data = {...data, rows: data.rows.map(row => ({...row}))};
  await Promise.resolve(); // Natural column layout precedes the virtual window.
  rowObserver.flush(); await nextFrame();
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(22);
  expect(el.querySelector("tbody tr[data-row-key]")).toBe(retained);
  rowHeight = 53;
  el.data = {...data, rows: data.rows.map(row => ({...row, extra: "taller content"}))};
  await Promise.resolve();
  rowObserver.flush(); await nextFrame();
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(20);
  const viewport = el.querySelector("[data-slot=table-scroll]")!;
  Object.defineProperty(viewport, "clientHeight", {configurable: true, value: 86});
  observers[0]!.callback([], observers[0]!); await nextFrame();
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(14);
});

it("re-renders after resize notifications on the next frame, once, never inside the observer callback", async () => {
  // A render inside the callback resizes observed rows in the same frame: browsers then report
  // "ResizeObserver loop completed with undelivered notifications", a page error to every check.
  const callbacks: ResizeObserverCallback[] = [];
  class DeferredResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", DeferredResizeObserver);
  // Shown, as in a browser: its headers measure (a table first drawn hidden measures again once shown).
  vi.spyOn(HTMLTableCellElement.prototype, "getBoundingClientRect").mockImplementation(() =>
    ({ width: 80, height: 20, x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 20, toJSON() {} }));
  const el = document.createElement("af-data-table") as AfDataTable;
  el.height = 420;
  el.cellRenderers = { edit: () => Object.assign(document.createElement("button"), { textContent: "Edit" }) };
  el.columns = [{ col: "value" }, { col: "edit", title: "" }];
  el.data = { columns: [{ name: "value", type: "number" }, { name: "edit", type: "string" }],
    rows: Array.from({ length: 100 }, (_, value) => ({ value, edit: "" })) };
  document.body.append(el);
  await Promise.resolve();
  const rows = [...el.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-key]")];
  expect(rows).toHaveLength(25);
  const entries = rows.map((target) => ({ target, contentRect: { height: 43 },
    borderBoxSize: [{ blockSize: 43 }] }) as unknown as ResizeObserverEntry);
  const render = vi.spyOn(el as unknown as { render(): void }, "render");
  callbacks.at(-1)?.(entries, {} as ResizeObserver);
  callbacks[0]?.([], {} as ResizeObserver);
  expect(render).not.toHaveBeenCalled();
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(25);
  await nextFrame();
  expect(render).toHaveBeenCalledTimes(1);
  expect(el.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(22);
  expect(el.querySelector<HTMLTableRowElement>("tbody tr[data-row-key]")?.style.transform).toBe("translateY(0px)");
  // A table removed before its frame does not render after it.
  callbacks[0]?.([], {} as ResizeObserver);
  el.remove();
  await nextFrame();
  expect(render).toHaveBeenCalledTimes(1);
});
it("shows a failed read's sentence and code instead of \"no rows\", and draws a cut-off answer with its row count", async () => {
  const columns = [{ name: "id", type: "number" as const }];
  const notice = SQL_FAILURES.permission_denied.notice;
  const denied = Object.assign(new Error(notice), { name: "SqlError", code: "permission_denied", detail: "42501 orders is not yours" });
  // A source whose read is refused: the alert says why, the code is on the element, and no "no rows" claims it is empty.
  const el = document.createElement("af-data-table") as AfDataTable;
  document.body.append(el);
  el.source = { read: async () => { throw denied; } };
  await vi.waitFor(() => expect(el.getAttribute("data-af-error")).toBe("permission_denied"), { timeout: WAIT_MS });
  expect(el.querySelector("[role=alert]")!.textContent).toBe(notice);
  expect(el.querySelectorAll("[role=alert]")).toHaveLength(1);
  expect(el.textContent).not.toContain("no rows");
  // A page that reads its rows itself hands the table the failure; new data clears it.
  const hand = document.createElement("af-data-table") as AfDataTable;
  document.body.append(hand);
  hand.data = { columns, rows: [] };
  expect(hand.textContent).toContain("no rows");
  for (const code of ["sign_in_required", "unavailable", "timeout", "dataset_not_found", "validation_failed"] as const) {
    hand.error = Object.assign(new Error(SQL_FAILURES[code].notice), { code, detail: code });
    expect(hand.getAttribute("data-af-error"), code).toBe(code);
    expect(hand.querySelector("[role=alert]")!.textContent, code).toBe(SQL_FAILURES[code].notice);
    expect(hand.textContent, code).not.toContain("no rows");
  }
  hand.data = { columns, rows: [{ id: 1 }] };
  expect(hand.hasAttribute("data-af-error")).toBe(false);
  expect(hand.querySelector("[role=alert]")).toBeNull();
  expect(hand.querySelector("tbody td")!.textContent).toBe("1");
  // Rows a read cut at its limit: drawn, with the row count the table shows for a partial answer.
  hand.data = { columns, rows: [{ id: 1 }, { id: 2 }], truncated: true };
  await nextFrame();
  expect(hand.querySelector("[data-slot=row-count]")!.textContent).toBe("2 of 2 rows");
  expect(hand.querySelectorAll("tbody tr[data-row-key]")).toHaveLength(2);
  el.remove(); hand.remove();
});
it("labels where its rows came from from the answer it was handed, and nothing for rows the page made", async () => {
  const columns = [{ name: "id", type: "number" as const }];
  const el = document.createElement("af-data-table") as AfDataTable;
  document.body.append(el);
  const rows = Object.defineProperty([{ id: 1 }], "source", { value: { kind: "snapshot", at: "2026-11-02T09:05:00.000Z", names: ["orders"] }, enumerable: false });
  el.data = { columns, rows };
  const label = () => el.querySelector(".af-data-source button");
  expect(label()!.textContent).toMatch(/^Snapshot · /);
  expect(label()!.getAttribute("aria-label")).toMatch(/^Data source: Snapshot · /);
  expect(el.querySelector(".af-data-source af-tooltip-content")!.textContent).toMatch(/^Stored data \(orders\), captured /);
  // The label stays put while the table rerenders.
  const before = el.querySelector(".af-data-source");
  el.columns = [{ col: "id", title: "ID" }];
  await nextFrame();
  expect(el.querySelector(".af-data-source")).toBe(before);
  el.error = Object.assign(new Error(SQL_FAILURES.consent_required.notice), { code: "consent_required", detail: "wh" });
  expect(label()!.textContent).toBe("Live · paused");
  el.data = { columns, rows: [{ id: 2 }] };
  expect(el.querySelector(".af-data-source")).toBeNull();
  // A source whose reads answer `sql` rows keeps the label through its pages.
  const page = (n: number) => Object.defineProperty([{ id: n }], "source", { value: { kind: "live", at: "2026-11-18T14:32:00.000Z" }, enumerable: false });
  el.source = { read: async ({ offset }) => ({ rows: page(offset), columns, truncated: offset === 0 }) };
  await vi.waitFor(() => expect(label()?.textContent).toBe("Live"), { timeout: WAIT_MS });
  await el.loadMore();
  expect(el.data.rows).toHaveLength(2);
  expect(label()!.textContent).toBe("Live");
  // Rows a draft's CSV answered in the frame: Snapshot, the file named, no time.
  el.data = { columns, rows: Object.defineProperty([{ id: 3 }], "source", { value: { kind: "file", names: ["churn.csv"] }, enumerable: false }) };
  expect(label()!.textContent).toBe("Snapshot");
  expect(el.querySelector(".af-data-source af-tooltip-content")!.textContent).toBe("Rows from churn.csv, a file beside the page.");
  el.remove();
});
/**
 * The declarative read: `sql="…"` runs through the page's `@afbin/apollo` (stood in for by a `sql` whose watches the
 * test answers by hand, as chart.test.ts does), so superseded and invalidated answers can be staged.
 */
type Watch = { text: string; next: (rows: unknown) => void; error: (e: Error) => void; stopped: boolean };
let watches: Watch[] = [];
const fakeSql = Object.assign((strings: TemplateStringsArray) => ({ text: strings.raw.join(""), params: {}, then: () => {} }), {
  watch(s: { text: string }, next: (rows: unknown) => void, error: (e: Error) => void) {
    const watch = { text: s.text, next, error, stopped: false };
    watches.push(watch);
    return () => { watch.stopped = true; };
  },
});
const answer = (rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) => {
  const names = Object.keys(rows[0] ?? {});
  const props = { columns: names.map((name) => ({ name, type: typeof rows[0]![name] === "number" ? "number" : "string" })), ...extra };
  for (const [key, value] of Object.entries(props)) Object.defineProperty(rows, key, { value, enumerable: false });
  return rows;
};
const live = { kind: "live", at: "2026-11-18T14:32:00.000Z" };
const watchFor = async (text: string) => {
  await vi.waitFor(() => expect(watches.filter((w) => w.text === text && !w.stopped)).toHaveLength(1), { timeout: WAIT_MS });
  return watches.find((w) => w.text === text && !w.stopped)!;
};
const cells = (el: Element) => [...el.querySelectorAll("tbody tr[data-row-key]")].map((tr) => tr.textContent);
const fakeApollo = () => { watches = []; vi.spyOn(pageSqlRuntime, "apollo").mockResolvedValue({ sql: fakeSql } as never); };
it("reads its sql attribute on connect as one live watch: rows, Live label, client-side sort, rereads on invalidation", async () => {
  fakeApollo();
  // As the parser makes it: the attribute is there before the element connects.
  document.body.innerHTML = '<af-data-table label="Orders" sql="select city, n from orders"></af-data-table>';
  const el = document.querySelector("af-data-table") as AfDataTable;
  const watch = await watchFor("select city, n from orders");
  expect(watches).toHaveLength(1);
  expect(el.getAttribute("aria-busy")).toBe("true");
  watch.next(answer([{ city: "Oslo", n: 3 }, { city: "Lima", n: 9 }], { source: live }));
  expect(el.hasAttribute("aria-busy")).toBe(false);
  expect(el.data.columns).toEqual([{ name: "city", type: "string" }, { name: "n", type: "number" }]);
  expect(cells(el)).toEqual(["Oslo3", "Lima9"]);
  expect(el.querySelector(".af-data-source button")!.textContent).toBe("Live");
  (el.querySelector('th[aria-label="Sort by n"]') as HTMLElement).click();
  (el.querySelector('th[aria-label="Sort by n"]') as HTMLElement).click();
  expect(el.sort).toEqual({ col: "n", dir: "desc" });
  expect(cells(el)).toEqual(["Lima9", "Oslo3"]);
  // A dataset it names changed: the same watch answers again; the sort the reader chose holds.
  watch.next(answer([{ city: "Oslo", n: 3 }, { city: "Lima", n: 9 }, { city: "Pune", n: 12 }], { source: live }));
  expect(cells(el)).toEqual(["Pune12", "Lima9", "Oslo3"]);
  // A cut-off answer draws with its row count.
  watch.next(answer([{ city: "Oslo", n: 3 }], { truncated: true, source: live }));
  await nextFrame();
  expect(el.querySelector("[data-slot=row-count]")!.textContent).toBe("1 of 1 rows");
  el.remove();
  expect(watch.stopped).toBe(true);
});
it("rereads when its sql attribute changes and drops the superseded statement's late answer", async () => {
  fakeApollo();
  const el = document.createElement("af-data-table") as AfDataTable;
  el.setAttribute("sql", "select 1 as a");
  document.body.append(el);
  const first = await watchFor("select 1 as a");
  el.setAttribute("sql", "select 2 as a");
  const second = await watchFor("select 2 as a");
  expect(first.stopped).toBe(true);
  first.next(answer([{ a: 1 }]));
  expect(el.data.rows).toEqual([]);
  second.next(answer([{ a: 2 }]));
  expect(cells(el)).toEqual(["2"]);
  el.remove();
});
it("shows a failed sql read's sentence and code, never \"no rows\", and refuses an empty sql attribute", async () => {
  fakeApollo();
  const el = document.createElement("af-data-table") as AfDataTable;
  el.setAttribute("sql", "select * from orders");
  document.body.append(el);
  const watch = await watchFor("select * from orders");
  const notice = SQL_FAILURES.permission_denied.notice;
  watch.error(Object.assign(new Error(notice), { code: "permission_denied", detail: "42501 orders is not yours" }));
  expect(el.getAttribute("data-af-error")).toBe("permission_denied");
  expect(el.querySelector("[role=alert]")!.textContent).toBe(notice);
  expect(el.hasAttribute("aria-busy")).toBe(false);
  expect(el.textContent).not.toContain("no rows");
  // The next answer clears the failure.
  watch.next(answer([{ id: 1 }]));
  expect(el.hasAttribute("data-af-error")).toBe(false);
  el.setAttribute("sql", "  ");
  expect(el.getAttribute("data-af-error")).toBe("validation_failed");
  expect(el.querySelector("[role=alert]")!.textContent).toBe("The sql attribute is empty");
  expect(watch.stopped).toBe(true);
  el.remove();
});
it("takes column titles from its columns attribute over sql rows", async () => {
  fakeApollo();
  document.body.innerHTML = `<af-data-table sql="select city from orders" columns='[{"col":"city","title":"Town"}]'></af-data-table>`;
  const el = document.querySelector("af-data-table") as AfDataTable;
  (await watchFor("select city from orders")).next(answer([{ city: "Oslo" }]));
  expect(el.querySelector("thead th")!.textContent).toContain("Town");
  el.remove();
});
