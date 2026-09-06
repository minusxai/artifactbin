import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import RemoteMentionPicker from "../RemoteMentionPicker";
afterEach(() => vi.unstubAllGlobals());
it("lets the user select an online session with a stable mention ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [
          {
            id: "123",
            name: "Backend",
            harness: "claude",
            machine: "laptop",
            online: true,
          },
          { id: "456", name: "Old", harness: "codex", online: false },
        ],
      }),
    }),
  );
  const select = vi.fn();
  render(<RemoteMentionPicker query="back" onSelect={select} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Mention Backend (claude)")).toBeTruthy(),
  );
  fireEvent.click(screen.getByLabelText("Mention Backend (claude)"));
  expect(select).toHaveBeenCalledWith("[@Backend](/chat?session=123) ");
  expect(screen.queryByLabelText("Mention Old (codex)")).toBeNull();
});
