import { createServer } from "node:http";

/** Deterministic OpenAI-compatible stream. Only disposable tests configure it. */
export async function startGenerationFixture() {
  let calls = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/stats") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ calls }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.headers.authorization !== "Bearer fixture-only-key") {
      res.writeHead(401);
      res.end();
      return;
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100_000) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    const body = JSON.parse(raw);
    calls++;
    const prompt = body.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    if (prompt.includes("slow"))
      await new Promise((resolve) => setTimeout(resolve, 21_000));
    const text = prompt.includes("invalid output")
      ? "not JSON"
      : JSON.stringify({
          title: "A new path",
          score: prompt.includes("decisive") ? 9 : 6,
        });
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of [
      {
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: text },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      },
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: body.model, ...chunk })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const models = JSON.stringify({
    default: {
      api: "openai-completions",
      baseUrl: `${url}/v1`,
      model: "fixture-model",
      apiKeyEnv: "GENERATION__FIXTURE_KEY",
    },
  });
  return {
    url,
    models,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
