import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Examples from "@/web/pages/Examples";
import WorkshopDirections from "../WorkshopDirections";
import { REASONS } from "@/lib/landing-content";
import { SHOWCASE, showcaseHref } from "@/lib/showcase";

it("filters the artifact wall without changing canonical destinations", () => {
  render(<Examples />);
  for (const doc of SHOWCASE)
    expect(screen.getByRole("link", { name: doc.title })).toHaveAttribute(
      "href",
      showcaseHref(doc),
    );
  fireEvent.click(screen.getByRole("button", { name: "Dashboards" }));
  expect(
    screen.getByRole("link", { name: "San Francisco City Payroll" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "The OpenAI-Hugging Face incident" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All work" }));
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
