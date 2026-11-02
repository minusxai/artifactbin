import {withHttpServer} from "./net.ts";
/** Deterministic model over actual HTTP/SSE; no paid provider or live account. */
export async function fixtureModel(mode = "normal") {
  const requests = [];
  const server = await withHttpServer(async (req, res) => {
    let raw = "";
    for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw);
    requests.push({
      body,
      authorized: req.headers.authorization === "Bearer fixture-key",
    });
    if (req.headers.authorization !== "Bearer fixture-key") {
      res.writeHead(401);
      res.end();
      return;
    }
    if (mode === "redirect") {
      res.writeHead(302, { location: "/credentials-must-not-reach-here" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (mode === "hang") return;
    const latestUser = body.messages.findLastIndex((m) => m.role === "user");
    const count = body.messages
      .slice(latestUser + 1)
      .filter((m) => m.role === "tool").length;
    const name = count === 0 ? "read_artifact" : "reply_comment";
    const chunks =
      count < 2
        ? [
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call-${count}`,
                        function: { name, arguments: "" },
                      },
                    ],
                  },
                },
              ],
            },
            ...(count === 0
              ? ["{", "}"]
              : ['{"body":"validated reply ', 'café"}']
            ).map((part) => ({
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: part } }],
                  },
                },
              ],
            })),
            {
              choices: [{ delta: {}, finish_reason: "tool_calls" }],
              usage: { prompt_tokens: 11, completion_tokens: 7 },
            },
          ]
        : [
            { choices: [{ delta: { content: "Done café" } }] },
            {
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 11, completion_tokens: 7 },
            },
          ];
    const encoded = Buffer.from(
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
        (mode === "truncated" ? "" : "data: [DONE]\n\n"),
    );
    // Split on arbitrary byte boundaries, including inside UTF-8 and tool arguments.
    for (let at = 0; at < encoded.length; at += 3)
      res.write(encoded.subarray(at, at + 3));
    res.end();
  });
  return { url: server.base, requests, close: server.close };
}

