/** Read a JSON response body, refusing one larger than `maxBytes`. */
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
