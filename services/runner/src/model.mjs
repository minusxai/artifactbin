const assistant = () => ({
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "openai",
    model: "fixture",
    usage: {
        input: null,
        output: null,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: null,
        cost: { input: null, output: null, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
});
/** Bound useful output separately from repeated SSE metadata. The transport remains
 * finite (eight times the output budget), including frames that produce no output. */
export async function readModel(response, maxBytes = 1024 * 1024) {
    if (!response.ok)
        throw Error(`ai_http_${response.status}`);
    const message = assistant(), decoder = new TextDecoder("utf-8", { fatal: true }), tools = new Map();
    let buffered = "", done = false, finish = false, received = 0, outputBytes = 0;
    const encoder = new TextEncoder();
    const consume = (text) => {
        outputBytes += encoder.encode(text).byteLength;
        if (outputBytes > maxBytes) throw Error("response_limit");
    };
    for await (const bytes of response.body) {
        received += bytes.byteLength;
        if (received > maxBytes * 8)
            throw Error("response_limit");
        buffered += decoder.decode(bytes, { stream: true });
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffered)) !== null) {
            const frame = buffered.slice(0, boundary.index);
            buffered = buffered.slice(boundary.index + boundary[0].length);
            const data = frame
                .split("\n")
                .filter((x) => x.startsWith("data:"))
                .map((x) => x.slice(5).trim())
                .join("\n");
            if (!data)
                continue;
            if (data === "[DONE]") {
                done = true;
                continue;
            }
            const chunk = JSON.parse(data), choice = chunk.choices?.[0];
            if (chunk.usage)
                message.usage = {
                    ...message.usage,
                    input: chunk.usage.prompt_tokens,
                    output: chunk.usage.completion_tokens,
                    totalTokens: chunk.usage.prompt_tokens + chunk.usage.completion_tokens,
                };
            if (choice?.finish_reason) {
                finish = true;
                message.stopReason =
                    choice.finish_reason === "tool_calls" ? "toolUse" : choice.finish_reason === "length" ? "length" : choice.finish_reason === "stop" ? "stop" : "error";
            }
            if (choice?.delta?.content) {
                consume(choice.delta.content);
                if (!message.content[0])
                    message.content.push({ type: "text", text: "" });
                message.content[0].text += choice.delta.content;
            }
            for (const delta of choice?.delta?.tool_calls ?? []) {
                const t = tools.get(delta.index) ?? { id: "", name: "", arguments: "" };
                consume(delta.id ?? "");
                consume(delta.function?.name ?? "");
                consume(delta.function?.arguments ?? "");
                t.id += delta.id ?? "";
                t.name += delta.function?.name ?? "";
                t.arguments += delta.function?.arguments ?? "";
                tools.set(delta.index, t);
            }
        }
    }
    buffered += decoder.decode();
    if (!done || !finish || buffered.trim())
        throw Error("stream_truncated");
    for (const tool of tools.values())
        message.content.push({
            type: "toolCall",
            id: tool.id,
            name: tool.name,
            arguments: JSON.parse(tool.arguments),
        });
    return message;
}
export async function boundedJson(response, maxBytes) {
    let text = "", bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes)
            throw Error("response_limit");
        text += decoder.decode(chunk, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
}
export const openaiMessages = (context) => context.messages.map((m) => m.role === "toolResult"
    ? {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: JSON.stringify(m.content),
    }
    : m.role === "assistant"
        ? {
            role: "assistant",
            content: m.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join(""),
            tool_calls: m.content
                .filter((c) => c.type === "toolCall")
                .map((c) => ({
                id: c.id,
                type: "function",
                function: {
                    name: c.name,
                    arguments: JSON.stringify(c.arguments),
                },
            })),
        }
        : {
            role: "user",
            content: typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content),
        });
