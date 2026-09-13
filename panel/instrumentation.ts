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

function responsesToChatBody(rawBody: BodyInit | null | undefined, model: string, openRouter: boolean) {
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

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: Math.max(Number(parsed?.max_output_tokens) || 650, 1400),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "freelance_bid",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              proposal: { type: "string" },
              durationDays: { type: "string", pattern: "^[0-9]{1,2}$" }
            },
            required: ["proposal", "durationDays"]
          }
        }
      }
    };

    if (openRouter) {
      body.provider = { require_parameters: true };
      body.reasoning = { enabled: false };
    }

    return JSON.stringify(body);
  } catch {
    return null;
  }
}

function chatOutputText(data: any): string {
  const message = data?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (content && typeof content === "object" && !Array.isArray(content)) {
    try { return JSON.stringify(content); } catch { /* ignore */ }
  }
  if (Array.isArray(content)) {
    return content
      .map((part: any) => typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (message?.parsed && typeof message.parsed === "object") {
    try { return JSON.stringify(message.parsed); } catch { /* ignore */ }
  }
  if (typeof data?.choices?.[0]?.text === "string") return data.choices[0].text.trim();
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

    const isOpenRouter = provider.baseUrl.includes("openrouter.ai");
    const chatBody = responsesToChatBody(init?.body, provider.model, isOpenRouter);
    if (!chatBody) return originalFetch(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${provider.apiKey}`);
    headers.set("Content-Type", "application/json");

    if (isOpenRouter) {
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
      console.info("[ai-provider]", {
        provider: provider.provider,
        upstreamModel: typeof data?.model === "string" ? data.model : provider.model,
        finishReason: data?.choices?.[0]?.finish_reason || null,
        outputLength: outputText.length
      });

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
