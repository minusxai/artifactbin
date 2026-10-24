import { afterEach, expect, it, vi } from "vitest";
import {
  createHtmlSelectionActions,
  type HtmlSelectionActions,
} from "../selection-actions";
import { htmlSelection } from "../../html-bridge/selection";
let actions: HtmlSelectionActions | undefined;
afterEach(() => {
  actions?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});
function setup() {
  document.body.innerHTML =
    '<p data-af-id="p">hello world</p><input data-af-id="input">';
  const chosen: string[] = [];
  actions = createHtmlSelectionActions({
    win: window,
    capture: (target) => htmlSelection(window, target, "1"),
    onAction: (action) => chosen.push(action),
  });
  actions.update(true);
  return chosen;
}
function select() {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector("p")!);
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}
it("offers explicit Comment and Select choices for keyboard selection without acting automatically", () => {
  const chosen = setup();
  select();
  expect(chosen).toEqual([]);
  expect(
    document.querySelector('[role="toolbar"]')?.getAttribute("aria-label"),
  ).toBe("Text selection actions");
  (
    document.querySelector(
      '[data-mx-selection-action="annotate"]',
    ) as HTMLElement
  ).click();
  expect(chosen).toEqual(["annotate"]);
  expect(document.querySelector<HTMLElement>('[role="toolbar"]')?.hidden).toBe(
    true,
  );
});
it("opens a block chooser on right click and only selects after the choice", () => {
  const chosen = setup();
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY: 30,
  });
  document.querySelector("p")!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(chosen).toEqual([]);
  (
    document.querySelector('[data-mx-selection-action="select"]') as HTMLElement
  ).click();
  expect(chosen).toEqual(["select"]);
});
it("preserves editable and shift right click menus and dismisses context choices on scroll", () => {
  setup();
  for (const target of [
    document.querySelector("input")!,
    document.querySelector("p")!,
  ]) {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      shiftKey: target.tagName === "P",
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  document
    .querySelector("p")!
    .dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  window.dispatchEvent(new Event("scroll"));
  expect(document.querySelector<HTMLElement>('[role="toolbar"]')?.hidden).toBe(
    true,
  );
});
it("revokes open choices and clears keyboard selections on Escape", () => {
  setup();
  select();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(window.getSelection()?.toString()).toBe("");
  select();
  actions!.update(false);
  expect(document.querySelector<HTMLElement>('[role="toolbar"]')?.hidden).toBe(
    true,
  );
});

it("waits for touch selection to settle and keeps the text bubble on viewport movement", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  setup();
  select();
  expect(document.querySelector<HTMLElement>('[role="toolbar"]')?.hidden).toBe(
    true,
  );
  vi.advanceTimersByTime(200);
  expect(document.querySelector<HTMLElement>('[role="toolbar"]')?.hidden).toBe(
    false,
  );
  expect(
    document.querySelector("button.mx-selection-action--coarse"),
  ).not.toBeNull();
  window.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new Event("scroll"));
  expect(document.querySelector<HTMLElement>('[role="toolbar"]')?.hidden).toBe(
    false,
  );
});
it("does not offer selection actions inside editable content", () => {
  setup();
  document.querySelector("p")!.setAttribute("contenteditable", "true");
  select();
  expect(document.querySelector<HTMLElement>('[role="toolbar"]')?.hidden).toBe(
    true,
  );
});

it("preserves the chosen button through a full pointer gesture", () => {
  const chosen = setup();
  select();
  const button = document.querySelector<HTMLElement>(
    '[data-mx-selection-action="annotate"]',
  )!;
  button.dispatchEvent(
    new Event("pointerdown", { bubbles: true, cancelable: true }),
  );
  button.dispatchEvent(new Event("pointerup", { bubbles: true }));
  expect(button.isConnected).toBe(true);
  button.click();
  expect(chosen).toEqual(["annotate"]);
});
