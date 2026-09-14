import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Examples from "@/web/pages/Examples";
import { WorkbenchDemo } from "../WorkshopDirections";
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
it("lets a visitor edit the sample and add a local comment", () => {
  render(<WorkbenchDemo />);
  fireEvent.change(screen.getByLabelText("Sample document title"), {
    target: { value: "A better first draft" },
  });
  expect(screen.getByDisplayValue("A better first draft")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Collaborate" }));
  fireEvent.change(screen.getByLabelText("Your sample comment"), {
    target: { value: "Show the regional breakdown." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
  expect(screen.getByText("Show the regional breakdown.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Explore data" }));
  fireEvent.change(screen.getByLabelText("Sample data region"), {
    target: { value: "Europe" },
  });
  expect(screen.getByText("Europe · 84 projects")).toBeInTheDocument();
});
