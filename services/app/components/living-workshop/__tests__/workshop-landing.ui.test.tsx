import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import WorkshopLanding from "@/web/pages/WorkshopLanding";
import { setWorkshopAppearance } from "@/lib/workshop-appearance";
import { WORKSHOP_PAPERS, WORKSHOP_SETTINGS } from "../scene-manifest";

const scene = vi.hoisted(() => ({
  reset: vi.fn(),
  setSetting: vi.fn(),
  detach: vi.fn(),
  dispose: vi.fn(),
}));
const createScene = vi.hoisted(() => vi.fn());
vi.mock("../workshop-renderer", () => ({ createWorkshopScene: createScene }));
const clipboard = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  createScene.mockReturnValue(scene);
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

it("prints the homepage artifacts on the board by default", async () => {
  mount();
  await waitFor(() => expect(createScene).toHaveBeenCalledWith(
    expect.any(HTMLCanvasElement),
    WORKSHOP_PAPERS,
    expect.any(Function),
    WORKSHOP_SETTINGS.indoor,
  ));
});

it("keeps real canonical links usable without interacting with the canvas", () => {
  mount();
  for (const paper of WORKSHOP_PAPERS)
    expect(screen.getByRole("link", { name: paper.title })).toHaveAttribute(
      "href",
      paper.href,
    );
});
it("copies deployment-aware agent instructions and reports a denied clipboard", async () => {
  clipboard
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("denied"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Create Artifact — copy agent instructions" }));
  await waitFor(() =>
    expect(clipboard).toHaveBeenCalledWith(
      `Help me create an artifact with artifactbin. Read ${window.location.origin}/docs-human for setup, then ask me what I want to make.`,
    ),
  );
  expect(
    await screen.findByText(/Copied\. Paste into your agent\./),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create Artifact — copy agent instructions" }));
  expect(
    await screen.findByText(/Couldn't copy\. Open the setup guide below\./),
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
      name: "Create Artifact — copy agent instructions",
    }),
  );
  await waitFor(() =>
    expect(clipboard).toHaveBeenCalledWith(
      expect.stringContaining("create an artifact with artifactbin."),
    ),
  );
  expect(
    await screen.findByText(/Copied\. Paste into your agent\./),
  ).toBeInTheDocument();
});

it("lets visitors open, reply to, and resolve a sample comment locally", () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Open sample comment by Maya" }));
  expect(screen.getByText("Demo conversation · replies stay on this page")).toBeInTheDocument();
  const reply = screen.getByRole("textbox", { name: "Reply to Maya" });
  expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
  fireEvent.change(reply, { target: { value: "Love this direction." } });
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  expect(screen.getByText("Love this direction.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close sample conversation" }));
  fireEvent.click(screen.getByRole("button", { name: "Open sample comment by Maya" }));
  expect(screen.getByText("Love this direction.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resolve sample conversation" }));
  expect(screen.queryByRole("textbox", { name: "Reply to Maya" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /sample comment by Maya/ })).not.toBeInTheDocument();
  expect(view.container.querySelector("[data-comment-highlight]")).toBeNull();
  expect(screen.getByRole("button", { name: "Open sample comment by Leo" })).toBeInTheDocument();
  view.unmount();
  mount();
  expect(screen.getByRole("button", { name: "Open sample comment by Maya" })).toBeInTheDocument();
});

it("keeps the sample conversations together in a single comments rail", () => {
  mount();
  const rail = screen.getByRole("complementary", { name: "Sample artifact comments" });
  expect(within(rail).getByText("Is this an artifact?")).toBeVisible();
  expect(within(rail).getByText("Is it easy to support other agents?")).toBeVisible();
  expect(within(rail).getAllByRole("button", { name: /Open sample comment by/ })).toHaveLength(8);
});

it("highlights the corresponding scene region on hover, focus, and open", () => {
  const { container } = mount();
  const maya = screen.getByRole("button", { name: "Open sample comment by Maya" });
  const leo = screen.getByRole("button", { name: "Open sample comment by Leo" });
  const highlight = () => container.querySelector("[data-comment-highlight]");
  expect(highlight()).toBeNull();
  fireEvent.mouseEnter(maya);
  expect(highlight()).toHaveAttribute("data-comment-highlight", "poster");
  fireEvent.mouseLeave(maya);
  expect(highlight()).toBeNull();
  fireEvent.focus(leo);
  expect(highlight()).toHaveAttribute("data-comment-highlight", "bots");
  fireEvent.blur(leo);
  expect(highlight()).toBeNull();
  fireEvent.click(maya);
  fireEvent.mouseLeave(maya);
  expect(highlight()).toHaveAttribute("data-comment-highlight", "poster");
  fireEvent.click(screen.getByRole("button", { name: "Close sample conversation" }));
  fireEvent.blur(maya);
  expect(highlight()).toBeNull();
});

 it("shows the poster exchange and the pi and OpenCode answers", () => {
  const { container } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Open sample comment by Maya" }));
  const poster = screen.getByRole("region", { name: "Sample conversation with Maya" });
  for (const text of ["Yep!", "Try tearing the posters off the board haha"]) expect(within(poster).getByText(text)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open sample comment by Leo" }));
  expect(screen.getByText("Yes, super easy!")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Sample conversation with Leo" })).getAllByText("pi").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Open sample comment by Nina" }));
  expect(container.querySelector("[data-comment-highlight]")).toHaveAttribute("data-comment-highlight", "install");
  const install = screen.getByRole("region", { name: "Sample conversation with Nina" });
  expect(within(install).getAllByText("OpenCode").length).toBeGreaterThan(0);
  expect(within(install).getByText(/The CLI gives your agent/)).toBeInTheDocument();
});

it("keeps FAQ exchanges short and removes the extra human from the poster thread", () => {
  mount();
  for (const name of ["Maya", "Leo", "Nina", "Sam", "Ava", "Ben", "Iris", "Theo"]) {
    fireEvent.click(screen.getByRole("button", { name: `Open sample comment by ${name}` }));
    const thread = screen.getByRole("region", { name: `Sample conversation with ${name}` });
    expect(within(thread).getAllByRole("article").length).toBeLessThanOrEqual(3);
    expect(within(thread).queryByText("Codex, what else can we do here?")).not.toBeInTheDocument();
    if (name === "Sam") expect(within(thread).getByText("Wait, why not just make an HTML file?")).toBeInTheDocument();
    if (name === "Theo") expect(within(thread).getByText(/hosted service is free today/)).toBeInTheDocument();
  }
});
