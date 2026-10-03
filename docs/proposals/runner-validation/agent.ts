import {
  AbortController,
  AbortSignal,
} from "abort-controller/dist/abort-controller.mjs";
import "fast-text-encoding";
import "core-js/web/url";
import "core-js/web/structured-clone";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
globalThis.AbortController = AbortController;
globalThis.AbortSignal = AbortSignal;
export default async function (input: any, context: any) {
  let streamError: any;
  const events: string[] = [];
  let checkpoints = Promise.resolve();
  const model = {
    id: "fixture",
    name: "fixture",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
  };
  const agent = new Agent({
    initialState: {
      model: model as any,
      messages: input.history ?? [],
      systemPrompt: "Read the artifact and respond to the assigned comment.",
      tools: [
        {
          name: "read_artifact",
          label: "Read",
          description: "Read assigned artifact",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          execute: async () => ({
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  await context.artifactbin.read({
                    artifactId: input.artifactId,
                  }),
                ),
              },
            ],
            details: {},
          }),
        },
        {
          name: "reply_comment",
          label: "Reply",
          description: "Reply to the assigned comment",
          parameters: {
            type: "object",
            properties: { body: { type: "string" } },
            required: ["body"],
            additionalProperties: false,
          },
          execute: async (_id: any, args: any) => ({
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  await context.artifactbin.reply({
                    body: args.body,
                    phase: "completed",
                  }),
                ),
              },
            ],
            details: {},
          }),
        },
      ] as any,
    },
    streamFn: (_model: any, llmContext: any) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          const { streamId } = await context.ai.open({
            context: {
              ...llmContext,
              tools: llmContext.tools.map((t: any) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          });
          while (true) {
            const event = await context.ai.next({ streamId });
            if (!event) break;
            stream.push(event);
          }
        } catch (error: any) {
          streamError = error;
          stream.end({
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: error.message,
            timestamp: Date.now(),
          } as any);
        }
      })();
      return stream;
    },
  });
  await context.artifactbin.reply({
    body: "Working on this comment.",
    phase: "acknowledged",
  });
  agent.subscribe((event) => {
    events.push(event.type);
    if (event.type === "message_end") {
      const messages = JSON.parse(JSON.stringify(agent.state.messages));
      checkpoints = checkpoints.then(() =>
        context.emit({ type: "checkpoint", messages }),
      );
    }
  });
  await agent.prompt(input.message);
  await checkpoints;
  if (streamError) throw streamError;
  if (
    agent.state.messages.some((m: any) => m.role === "toolResult" && m.isError)
  )
    throw Error("agent_tool_failed");
  await context.emit({ type: "checkpoint", messages: agent.state.messages });
  return { messages: agent.state.messages, events, outcome: "completed" };
}
