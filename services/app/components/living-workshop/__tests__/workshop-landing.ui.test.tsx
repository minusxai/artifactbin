import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import WorkshopLanding from "@/web/pages/WorkshopLanding";
import { setWorkshopAppearance } from "@/lib/workshop-appearance";
import { WORKSHOP_PAPERS } from "../scene-manifest";

const scene = vi.hoisted(() => ({
  reset: vi.fn(),
  setSetting: vi.fn(),
  detach: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../workshop-renderer", () => ({ createWorkshopScene: () => scene }));
const clipboard = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
});
const mount = () =>
  render(
    <MemoryRouter>
      <WorkshopLanding />
    </MemoryRouter>,
  );

it("keeps real canonical links usable without interacting with the canvas", () => {
  mount();
  for (const paper of WORKSHOP_PAPERS)
    expect(screen.getByRole("link", { name: paper.title })).toHaveAttribute(
      "href",
      paper.href,
    );
});
it("copies the deployment-aware install command and reports a denied clipboard", async () => {
  clipboard
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("denied"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Copy install command" }));
  await waitFor(() =>
    expect(clipboard).toHaveBeenCalledWith(
      `curl -fsSL ${window.location.origin}/chat/install.sh | sh`,
    ),
  );
  expect(
    await screen.findByText("Copied — paste into your terminal"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy install command" }));
  expect(
    await screen.findByText("Select and copy the command above."),
  ).toBeInTheDocument();
});
it("switches the background without disposing the live board", async () => {
  const view = mount();
  await act(async () => {});
  act(() => setWorkshopAppearance("outdoor"));
  expect(scene.setSetting).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "outdoor" }),
  );
  expect(scene.dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(scene.dispose).toHaveBeenCalledOnce();
});

it("copies an agent prompt from the green create action", async () => {
  clipboard.mockResolvedValue(undefined);
  mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Copy instructions to create an artifact",
    }),
  );
  await waitFor(() =>
    expect(clipboard).toHaveBeenCalledWith(
      expect.stringContaining("Create an artifact with artifactbin."),
    ),
  );
  expect(
    await screen.findByText("Paste the instructions into your agent."),
  ).toBeInTheDocument();
});
