import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import HomeV2 from "@/web/pages/HomeV2";
import { WORKSHOP_PAPERS } from "../scene-manifest";

const scene = vi.hoisted(() => ({
  reset: vi.fn(),
  detach: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../workshop-renderer", () => ({ createWorkshopScene: () => scene }));
const clipboard = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
});
const mount = () =>
  render(
    <MemoryRouter>
      <HomeV2 />
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
it("provides keyboard reveal without a reset strip and disposes the scene on leaving", () => {
  const view = mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Reveal behind ${WORKSHOP_PAPERS[0].title}`,
    }),
  );
  expect(scene.detach).toHaveBeenCalledWith(WORKSHOP_PAPERS[0].id);
  expect(
    screen.queryByRole("button", { name: "Reset board" }),
  ).not.toBeInTheDocument();
  view.unmount();
  expect(scene.dispose).toHaveBeenCalled();
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
