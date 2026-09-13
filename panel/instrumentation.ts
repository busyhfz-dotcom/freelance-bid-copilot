import { resolveAIProvider } from "./lib/ai-provider";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const PATCH_MARK = Symbol.for("freelance-bid-copilot.ai-provider-fetch");

export function register() {
  const state = globalThis as typeof globalThis & { [PATCH_MARK]?: boolean };
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

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${provider.apiKey}`);
    headers.set("Content-Type", "application/json");

    let body = init?.body;
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body);
        parsed.model = provider.model;
        body = JSON.stringify(parsed);
      } catch {
        // Preserve the original request body; the provider will return a useful error.
      }
    }

    return originalFetch(provider.endpoint, { ...init, headers, body });
  }) as typeof globalThis.fetch;
}
