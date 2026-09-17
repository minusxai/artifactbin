import { render, waitFor, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { it, expect, vi, afterEach } from "vitest";
const { write, scrollPages, scrollLines, scrollToBottom } = vi.hoisted(() => ({
  scrollPages: vi.fn(), scrollLines: vi.fn(), scrollToBottom: vi.fn(),
  write: vi.fn((data: string, callback?: () => void) => {
    if (data) callback?.();
  }),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = write;
    scrollPages = scrollPages;
    scrollLines = scrollLines;
    scrollToBottom = scrollToBottom;
    loadAddon() {}
    open() {}
    resize() {}
    reset() {}
    dispose() {}
    onData() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
  },
}));
import { ChatPage } from "../pages/Chat";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  write.mockClear();
});
it("keeps polling through empty terminal frames and renders later output", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const session = {
    id: "test",
    name: "Demo",
    harness: "claude",
    machine: "laptop",
    online: true,
    controller: "local",
    cols: 80,
    rows: 24,
    exitCode: null,
  };
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url === "/api/remote/sessions"
          ? { sessions: [session] }
          : ++calls === 1
            ? { session, seq: 1, snapshot: "", frames: [] }
            : {
                session,
                seq: 2,
                frames: [{ seq: 2, cols: 80, rows: 24, data: "later output" }],
              },
    })),
  );
  render(
    <MemoryRouter initialEntries={["/chat?session=test"]}>
      <ChatPage />
    </MemoryRouter>,
  );
  await waitFor(
    () =>
      expect(write).toHaveBeenCalledWith("later output", expect.any(Function)),
    { timeout: 2000 },
  );
  expect(write).not.toHaveBeenCalledWith("", expect.any(Function));
});

it("shows an ended session without terminal input controls", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const session = {
    id: "done", name: "Claude", harness: "claude", machine: "laptop",
    online: false, controller: "local", cols: 80, rows: 24, exitCode: 0,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === "/api/remote/sessions"
      ? { sessions: [session] }
      : { session, seq: 1, snapshot: "", frames: [] },
  })));
  render(<MemoryRouter initialEntries={["/chat?session=done"]}><ChatPage /></MemoryRouter>);
  expect(await screen.findByText(/Session ended \(exit 0\)/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remove session" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Take control" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message to agent" })).toBeNull();
  expect(screen.getByText("claude · Ended")).toBeTruthy();
});

it("retries failed polls, clears reconnecting on recovery, and scrolls without sending input", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const session = { id: "retry", name: "Retry", harness: "claude", machine: "laptop", online: true, controller: "local", cols: 80, rows: 24, exitCode: null };
  let polls = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url === "/api/remote/sessions") return { ok: true, json: async () => ({ sessions: [session] }) };
    polls++;
    if (polls <= 2) throw new TypeError("Failed to fetch");
    return { ok: true, json: async () => ({ session, seq: 1, snapshot: "recovered output", frames: [] }) };
  });
  vi.stubGlobal("fetch", fetch);
  render(<MemoryRouter initialEntries={["/chat?session=retry"]}><ChatPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByRole("status").map(el => el.textContent).join(" ")).toContain("Reconnecting"));
  await waitFor(() => expect(write).toHaveBeenCalledWith("recovered output", expect.any(Function)), { timeout: 3000 });
  await waitFor(() => expect(screen.queryByText(/Retrying automatically/)).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Scroll up" }));
  fireEvent.click(screen.getByRole("button", { name: "Scroll down" }));
  fireEvent.click(screen.getByRole("button", { name: "Latest output" }));
  expect(scrollPages).toHaveBeenCalledWith(-1);
  expect(scrollPages).toHaveBeenCalledWith(1);
  expect(scrollToBottom).toHaveBeenCalled();
  const terminal = screen.getByLabelText("Remote terminal");
  fireEvent.touchStart(terminal, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(terminal, { touches: [{ clientY: 52 }] });
  expect(scrollLines).toHaveBeenCalledWith(3);
  fireEvent.touchMove(terminal, { touches: [{ clientY: 116 }] });
  expect(scrollLines).toHaveBeenCalledWith(-4);
  expect(fetch.mock.calls.every(call => !((call as unknown[])[1] as RequestInit)?.body)).toBe(true);
});

it("reloads a snapshot when relay generation changes even if the sequence is reused", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const session = { id: "gen", name: "Generation", harness: "shell", machine: "laptop", online: true, controller: "local", cols: 80, rows: 24, exitCode: null };
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/remote/sessions") return { ok: true, json: async () => ({ sessions: [session] }) };
    urls.push(url);
    const n = urls.length;
    return { ok: true, json: async () => ({ session, seq: 1, generation: n === 1 ? "old" : "new", frames: [], ...(n === 1 ? { snapshot: "old screen" } : url.endsWith("since=-1") ? { snapshot: "restored screen" } : {}) }) };
  }));
  render(<MemoryRouter initialEntries={["/chat?session=gen"]}><ChatPage /></MemoryRouter>);
  await waitFor(() => expect(write).toHaveBeenCalledWith("restored screen", expect.any(Function)));
  expect(urls.slice(0, 3)).toEqual(["/api/remote/sessions/gen?since=-1", "/api/remote/sessions/gen?since=1", "/api/remote/sessions/gen?since=-1"]);
});
