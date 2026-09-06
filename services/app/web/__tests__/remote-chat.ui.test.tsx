import { render, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { it, expect, vi, afterEach } from "vitest";
const { write } = vi.hoisted(() => ({
  write: vi.fn((data: string, callback?: () => void) => {
    if (data) callback?.();
  }),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = write;
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
