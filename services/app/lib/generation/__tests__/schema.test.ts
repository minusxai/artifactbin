import { expect, it } from "vitest";
import { generationSchema } from "../schema";

it("preserves enum sibling constraints throughout nested schemas", () => {
  const schema = generationSchema(
    JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["scores"],
      properties: {
        scores: {
          type: "array",
          items: { type: "number", minimum: 5, enum: [1, 6, "6"] },
        },
      },
    }),
  );
  expect(schema.safeParse({ scores: [6] }).success).toBe(true);
  expect(schema.safeParse({ scores: [1] }).success).toBe(false);
  expect(schema.safeParse({ scores: ["6"] }).success).toBe(false);
  const text = generationSchema(
    JSON.stringify({ type: "string", minLength: 3, enum: ["a", "abc"] }),
  );
  expect(text.safeParse("a").success).toBe(false);
  expect(text.safeParse("abc").success).toBe(true);
});
