import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import Examples from "@/web/pages/Examples";
import WorkshopDirections from "../WorkshopDirections";
import { REASONS } from "@/lib/landing-content";
import { SHOWCASE, SHOWCASE_FORMATS, showcaseHref } from "@/lib/showcase";

it("filters the artifact wall without changing canonical destinations", () => {
  render(<Examples />);
  for (const doc of SHOWCASE)
    expect(screen.getByRole("link", { name: doc.title })).toHaveAttribute(
      "href",
      showcaseHref(doc),
    );
  fireEvent.click(screen.getByRole("button", { name: "Dashboards" }));
  expect(
    screen.getByRole("link", { name: "SF City Payroll" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "The OpenAI-Hugging Face incident" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All artifacts" }));
  expect(
    screen.getByRole("link", { name: "The OpenAI-Hugging Face incident" }),
  ).toBeInTheDocument();
});
it("opens every published example and reveals the selected outcome", () => {
  render(<WorkshopDirections />);
  for (const doc of SHOWCASE)
    for (const link of screen.getAllByRole("link", { name: doc.title }))
      expect(link).toHaveAttribute("href", showcaseHref(doc));
  expect(screen.getByText(REASONS[0]!.body)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: /Don't waste tokens/, expanded: false }),
  );
  expect(screen.getByText(REASONS[3]!.body)).toBeVisible();
  expect(screen.queryByText(REASONS[0]!.body)).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: REASONS[3]!.alt })).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: `Preview: ${REASONS[4]!.title}` }),
  );
  expect(screen.getByText(REASONS[4]!.body)).toBeVisible();
  expect(
    screen.getByRole("button", { name: `Preview: ${REASONS[4]!.title}` }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("offers every catalog category and filters to that exact kind", () => {
  render(<Examples />);
  const filters = within(screen.getByRole("group", { name: "Filter artifacts" }));
  const wall = within(screen.getByRole("region", { name: "Published artifacts" }));
  expect(filters.getAllByRole("button")).toHaveLength(SHOWCASE_FORMATS.length + 1);
  for (const { kind, label } of SHOWCASE_FORMATS) {
    const button = filters.getByRole("button", { name: label.charAt(0).toUpperCase() + label.slice(1) });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    const expected = SHOWCASE.filter(doc => doc.kind === kind);
    expect(wall.getAllByRole("link")).toHaveLength(expected.length);
    for (const doc of expected) expect(wall.getByRole("link", { name: doc.title })).toHaveAttribute("href", showcaseHref(doc));
    expect(screen.getByRole("status")).toHaveTextContent(`${expected.length} artifacts`);
  }
  fireEvent.click(filters.getByRole("button", { name: "All artifacts" }));
  expect(wall.getAllByRole("link")).toHaveLength(SHOWCASE.length);
});
