import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admitPresentationKit,
  presentationKitComponent,
} from "../src/migration/conversion/compiled/presentation-kit.ts";

test("archived presentation capabilities preserve shells, deferred content and transparent providers", () => {
  assert.equal(presentationKitComponent("DialogTitle"), null);
  assert.equal(presentationKitComponent("AvatarImage"), null);
  assert.equal(
    admitPresentationKit("Tooltip", { defaultOpen: false }).identity,
    "transparent",
  );
  assert.equal(
    admitPresentationKit("TooltipProvider", {}).identity,
    "transparent",
  );
  const content = admitPresentationKit("TooltipContent", {}, ["Tooltip"]);
  assert.equal(content.identity, "direct");
  assert.equal(content.portal, true);
  assert.equal(
    admitPresentationKit("TooltipContent", { forceMount: true }, ["Tooltip"])
      .identity,
    "direct",
  );
  const accordion = admitPresentationKit("AccordionContent", {}, [
    "Accordion",
    "AccordionItem",
  ]);
  assert.equal(accordion.identity, "direct");
  assert.equal(accordion.conditionalChildren, false);
  assert.equal(
    admitPresentationKit("AccordionContent", { forceMount: true }, [
      "Accordion",
      "AccordionItem",
    ]).conditionalChildren,
    false,
  );
  assert.equal(
    admitPresentationKit("DialogContent", {}, ["Dialog"]).identity,
    "direct",
  );
});

test("presentation children require their nearest corresponding root context", () => {
  for (const tag of [
    "AccordionItem",
    "AccordionTrigger",
    "AccordionContent",
    "TooltipTrigger",
    "TooltipContent",
    "DialogTrigger",
    "DialogClose",
    "DialogContent",
    "AvatarFallback",
  ])
    assert.throws(() => admitPresentationKit(tag, {}), /context/);
  assert.throws(
    () =>
      admitPresentationKit("AccordionTrigger", {}, [
        "Accordion",
        "AccordionItem",
        "Accordion",
      ]),
    /context/,
  );
  assert.throws(
    () =>
      admitPresentationKit("AccordionItem", { value: "one" }, [
        "AccordionItem",
      ]),
    /context/,
  );
  assert.equal(
    admitPresentationKit("AccordionTrigger", {}, [
      "Accordion",
      "AccordionItem",
      "div",
    ]).tag,
    "AccordionTrigger",
  );
  assert.equal(
    admitPresentationKit(
      "AvatarFallback",
      { className: "rounded-full", "data-af-id": "fallback" },
      ["Avatar"],
    ).identity,
    "direct",
  );
});

test("only static archived props are admitted without executable actions or guessed aliases", () => {
  assert.equal(
    admitPresentationKit("Accordion", {
      type: "single",
      collapsible: true,
      defaultValue: "one",
      orientation: "vertical",
    }).tag,
    "Accordion",
  );
  for (const attrs of [
    { type: "multiple" },
    { defaultValue: "$open" },
    { onValueChange: "handler" },
    { disabled: true },
  ])
    assert.throws(() => admitPresentationKit("Accordion", attrs));
  for (const attrs of [
    { run: "$save" },
    { args: {} },
    { onClick: "save" },
    { open: true },
    { stacked: "yes" },
  ])
    assert.throws(() =>
      admitPresentationKit("DialogContent", attrs, ["Dialog"]),
    );
  for (const attrs of [
    { forceMount: "true" },
    { side: "bottom" },
    { style: { color: "red" } },
    { ref: "node" },
    { constructor: "x" },
  ])
    assert.throws(() =>
      admitPresentationKit("TooltipContent", attrs, ["Tooltip"]),
    );
  assert.throws(
    () => admitPresentationKit("AccordionItem", {}, ["Accordion"]),
    /value/,
  );
  assert.throws(
    () => admitPresentationKit("Tooltip", { className: "discarded" }),
    /attribute/,
  );
  assert.throws(() => admitPresentationKit("Avatar", { size: () => "small" }));
  assert.equal(
    admitPresentationKit(
      "DialogTrigger",
      { disabled: true, wrapsControl: true, "aria-label": "Open" },
      ["Dialog"],
    ).tag,
    "DialogTrigger",
  );
});
