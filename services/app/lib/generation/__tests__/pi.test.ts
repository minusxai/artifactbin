import { afterAll, expect, it } from "vitest";
import { withHttpServer } from "@/__tests__/net";
import { createPiGeneration } from "../pi";
import { parseGenerationModels } from "../configuration";

const calls: Array<{
  body: Record<string, unknown>;
  authorization: string | undefined;
}> = [];
const fixture = await withHttpServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  calls.push({
    body: JSON.parse(body),
    authorization: req.headers.authorization,
  });
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of [
    {
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: '{"score":6}' },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    },
  ])
    res.write(
      `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture-model", ...chunk })}\n\n`,
    );
  res.end("data: [DONE]\n\n");
});
afterAll(() => fixture.close());

it("uses the real Pi transport with explicit configured credentials and normalized usage", async () => {
  const models = parseGenerationModels(
    JSON.stringify({
      narrator: {
        api: "openai-completions",
        baseUrl: `${fixture.base}/v1`,
        model: "fixture-model",
        apiKeyEnv: "GENERATION__TEST_KEY",
      },
    }),
    () => "fixture-only-key",
  );
  const svc = createPiGeneration(models);
  const result = await svc.generate(
    {
      key: "fixture",
      model: "narrator",
      prompt: "Go left",
      schema: '{"type":"object"}',
    },
    new AbortController().signal,
  );
  expect(result).toEqual({
    json: '{"score":6}',
    usage: { input: 20, output: 5 },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].authorization).toBe("Bearer fixture-only-key");
  expect(calls[0].body).toMatchObject({
    model: "fixture-model",
    stream: true,
    messages: expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "Go left" }),
    ]),
  });
  await expect(
    svc.generate(
      { key: "bad", model: "unconfigured", prompt: "hi", schema: "{}" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("not configured");
  expect(calls).toHaveLength(1);
});

it("rejects invalid configuration without echoing secret values", () => {
  const secret = "must-not-appear";
  for (const config of [
    { model: secret },
    { api: "bad", apiKey: secret },
    {
      api: "openai-completions",
      baseUrl: `https://user:${secret}@example.com`,
      model: "m",
      apiKey: secret,
    },
  ]) {
    expect(() =>
      parseGenerationModels(
        JSON.stringify({ narrator: config }),
        () => "fixture-only-key",
      ),
    ).toThrow("GENERATION__MODELS_FILE");
    try {
      parseGenerationModels(
        JSON.stringify({ narrator: config }),
        () => "fixture-only-key",
      );
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  }
});

it("uses one connection for calls with different sampling options", async () => {
  const svc = createPiGeneration(
    parseGenerationModels(
      JSON.stringify({
        default: {
          api: "openai-completions",
          baseUrl: `${fixture.base}/v1`,
          model: "fixture-model",
          apiKeyEnv: "GENERATION__TEST_KEY",
        },
      }),
      () => "fixture-only-key",
    ),
  );
  const start = calls.length;
  for (const temperature of [0.9, 0.3])
    await svc.generate(
      {
        key: String(temperature),
        model: "default",
        prompt: "role prompt",
        schema: '{"type":"object"}',
        options: { temperature, maxTokens: 8192 },
      },
      new AbortController().signal,
    );
  expect(calls.slice(start).map((c) => c.body.temperature)).toEqual([0.9, 0.3]);
  expect(calls.slice(start).map((c) => c.body.max_completion_tokens)).toEqual([
    8192, 8192,
  ]);
});
