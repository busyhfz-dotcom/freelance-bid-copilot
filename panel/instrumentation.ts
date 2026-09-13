import { resolveAIProvider } from "./lib/ai-provider";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const PATCH_MARK = Symbol.for("freelance-bid-copilot.ai-provider-fetch");

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

function responsesToChatBody(rawBody: BodyInit | null | undefined, model: string) {
  if (typeof rawBody !== "string") return null;
  try {
    const parsed = JSON.parse(rawBody);
    const messages = Array.isArray(parsed?.input)
      ? parsed.input
          .map((item: any) => ({
            role: typeof item?.role === "string" ? item.role : "user",
            content: contentText(item?.content)
          }))
          .filter((item: any) => item.content)
      : [];

    if (!messages.length) return null;

    return JSON.stringify({
      model,
      messages,
      max_tokens: Number(parsed?.max_output_tokens) || 650,
      response_format: { type: "json_object" }
    });
  } catch {
    return null;
  }
}

function chatOutputText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => typeof part?.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export function register() {
  const state = globalThis as any;
  if (state[PATCH_MARK]) return;
  state[PATCH_MARK] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (requestUrl !== OPENAI_RESPONSES_URL) return originalFetch(input, init);

    const provider = resolveAIProvider();
    if (!provider.configured || provider.provider === "openai") return originalFetch(input, init);

    const chatBody = responsesToChatBody(init?.body, provider.model);
    if (!chatBody) return originalFetch(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${provider.apiKey}`);
    headers.set("Content-Type", "application/json");

    // OpenRouter accepts these headers and uses them only for app attribution.
    if (provider.baseUrl.includes("openrouter.ai")) {
      headers.set("HTTP-Referer", "https://www.freelancerpanel.ir");
      headers.set("X-Title", "Freelance Bid Copilot");
    }

    const chatEndpoint = `${provider.baseUrl}/chat/completions`;
    const response = await originalFetch(chatEndpoint, { ...init, headers, body: chatBody });
    if (!response.ok) return response;

    const raw = await response.text();
    try {
      const data = JSON.parse(raw);
      const outputText = chatOutputText(data);
      if (!outputText) {
        const passthroughHeaders = new Headers(response.headers);
        passthroughHeaders.delete("content-length");
        return new Response(raw, { status: response.status, statusText: response.statusText, headers: passthroughHeaders });
      }

      const normalizedHeaders = new Headers(response.headers);
      normalizedHeaders.set("Content-Type", "application/json");
      normalizedHeaders.delete("content-length");
      return new Response(JSON.stringify({ output_text: outputText }), {
        status: response.status,
        statusText: response.statusText,
        headers: normalizedHeaders
      });
    } catch {
      const passthroughHeaders = new Headers(response.headers);
      passthroughHeaders.delete("content-length");
      return new Response(raw, { status: response.status, statusText: response.statusText, headers: passthroughHeaders });
    }
  }) as typeof globalThis.fetch;
}
