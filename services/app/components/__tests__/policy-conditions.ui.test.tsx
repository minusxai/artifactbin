import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PolicyPredicate } from "@artifactbin/contracts";
import { PolicyConditions } from "../PolicyConditions";
afterEach(cleanup);
function Editor({ initial }: { initial: PolicyPredicate }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PolicyConditions
        label="rows"
        title="Rows"
        columns={[{ name: "quantity" }, { name: "status" }]}
        value={value}
        onChange={setValue}
      />
      <output aria-label="Result">{JSON.stringify(value)}</output>
    </>
  );
}
const result = () => JSON.parse(screen.getByLabelText("Result").textContent!);
it("removes an alternative instead of leaving an always-true empty predicate", () => {
  render(
    <Editor
      initial={{
        _or: [{ status: { _eq: "draft" } }, { quantity: { _gte: 1 } }],
      }}
    />,
  );
  fireEvent.click(screen.getByLabelText("Remove rows.1.1 condition"));
  expect(result()).toEqual({ _or: [{ quantity: { _gte: 1 } }] });
});
it("changing a comparison never overwrites a sibling comparison", () => {
  render(<Editor initial={{ quantity: { _gte: 1, _lte: 10 } }} />);
  fireEvent.change(screen.getByLabelText("rows.1 operator"), {
    target: { value: "_lte" },
  });
  expect(result()).toEqual({
    _and: [{ quantity: { _lte: 10 } }, { quantity: { _lte: 1 } }],
  });
});
it("adds a group and changes All, Any and Not without losing conditions", () => {
  render(<Editor initial={{}} />);
  fireEvent.click(screen.getByLabelText("Add rows group"));
  fireEvent.change(screen.getByLabelText("rows.1 match"), {
    target: { value: "_not" },
  });
  expect(result()).toEqual({ _and: [{ _not: { quantity: { _eq: "" } } }] });
  fireEvent.change(screen.getByLabelText("rows.1 match"), {
    target: { value: "_and" },
  });
  expect(result()).toEqual({ _and: [{ _and: [{ quantity: { _eq: "" } }] }] });
});

it("can populate an empty Not group loaded from policy source", () => {
  render(<Editor initial={{ _not: {} }} />);
  fireEvent.click(screen.getByLabelText("Add rows.1 empty condition"));
  expect(result()).toEqual({ _not: { quantity: { _eq: "" } } });
});
