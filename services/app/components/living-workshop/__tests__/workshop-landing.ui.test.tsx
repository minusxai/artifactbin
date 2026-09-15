import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  setSetting: vi.fn(),
  dispose: vi.fn(),
}));
const createScene = vi.hoisted(() => vi.fn());
vi.mock("../workshop-renderer", () => ({ createWorkshopScene: createScene }));
const clipboard = vi.fn();
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  clipboard.mockReset();
  // jsdom has no layout; give the comment positioner a visible scene.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1448, 815));
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
    WORKSHOP_SETTINGS.indoor,
  ));
});

it("keeps the Star link before the collapsible desktop links", () => {
  mount();
  const navigation = screen.getByRole("navigation", { name: "Main navigation" });
  const star = within(navigation).getByRole("link", { name: "Star artifactbin on GitHub" });
  const gallery = within(navigation).getByRole("link", { name: "Gallery" });
  expect(star.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(star.closest(".workshop-nav-desktop")).toBeNull();
});

it("keeps real canonical links usable without interacting with the canvas", () => {
  mount();
  for (const paper of WORKSHOP_PAPERS)
    for (const link of screen.getAllByRole("link", { name: paper.title }))
      expect(link).toHaveAttribute("href", paper.href);
});
it.each(["hero", "footer"])("copies deployment-aware instructions from the %s and reports clipboard denial", async (area) => {
  clipboard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
  const { container } = mount();
  const scope = within(area === "hero"
    ? screen.getByRole("region", { name: "The artifactbin workshop" })
    : container.querySelector("footer")!);
  const button = scope.getByRole("button", { name: "Create Artifact — copy agent instructions" });
  fireEvent.click(button);
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(
    `Help me create an artifact with artifactbin. Read ${window.location.origin}/docs-human for setup, then ask me what I want to make.`,
  ));
  expect(await scope.findByText(/Copied\. Paste into your agent\./)).toBeInTheDocument();
  fireEvent.click(button);
  expect(await scope.findByText(/Couldn't copy\. Open the setup guide/)).toBeInTheDocument();
  expect(scope.getByRole("link", { name: /Setup guide/ })).toHaveAttribute("href", "/docs-human");
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

it("opens mobile conversations without focusing the reply keyboard and restores the pin on dismissal", () => {
  vi.stubGlobal("innerWidth", 390);
  mount();
  const pin = screen.getByRole("button", { name: "Open sample comment by Maya" });
  fireEvent.click(pin);
  const conversation = screen.getByRole("dialog", { name: "Sample conversation with Maya" });
  expect(conversation).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Reply to Maya" })).not.toHaveFocus();
  fireEvent.keyDown(conversation, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(pin).toHaveFocus();
  expect(document.querySelector("[data-comment-highlight]")).toBeNull();
  expect(pin).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(pin);
  fireEvent.click(screen.getByRole("button", { name: "Close sample conversation" }));
  expect(document.querySelector("[data-comment-highlight]")).toBeNull();
  fireEvent.click(pin);
  fireEvent.click(pin);
  expect(document.querySelector("[data-comment-highlight]")).toBeNull();
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

it("keeps the FAQ and footer links after the feature section", () => {
  const { container } = mount();
  const features = screen.getByRole("region", { name: /Agent-ready infrastructure/ });
  const faq = screen.getByLabelText("FAQs");
  const footer = container.querySelector("footer")!;
  expect(features.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(faq.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const [name, href] of [["Gallery", "/examples"], ["Docs", "/docs-human"], ["Privacy", "/privacy"], ["Terms", "/terms"]])
    expect(within(footer).getByRole("link", { name })).toHaveAttribute("href", href);
});

it("opens navigation from the mobile hamburger and dismisses with Escape", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  const menu = screen.getByRole("navigation", { name: "Menu" });
  expect(within(menu).getByRole("link", { name: "Gallery" })).toHaveAttribute("href", "/examples");
  expect(within(menu).getByRole("link", { name: "Human Docs" })).toHaveAttribute("href", "/docs-human");
  expect(within(menu).getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("navigation", { name: "Menu" })).not.toBeInTheDocument();
});
