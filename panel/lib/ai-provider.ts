export type AIProviderName = "openai" | "groq" | "custom";

export type AIProviderConfig = {
  provider: AIProviderName;
  apiKey: string;
  model: string;
  baseUrl: string;
  endpoint: string;
  configured: boolean;
};

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function resolveProviderName(): AIProviderName {
  const explicit = env("AI_PROVIDER").toLowerCase();
  if (explicit === "groq" || explicit === "openai" || explicit === "custom") return explicit;

  // Prefer Groq automatically when its dedicated key is present. This lets a
  // deployment keep legacy OpenAI variables as a fallback without extra flags.
  if (env("GROQ_API_KEY")) return "groq";
  return "openai";
}

export function resolveAIProvider(): AIProviderConfig {
  const provider = resolveProviderName();

  let apiKey = "";
  let model = "";
  let baseUrl = "";

  if (provider === "groq") {
    apiKey = env("GROQ_API_KEY") || env("AI_API_KEY");
    model = env("GROQ_MODEL") || env("AI_MODEL") || GROQ_DEFAULT_MODEL;
    baseUrl = env("AI_BASE_URL") || GROQ_BASE_URL;
  } else if (provider === "custom") {
    apiKey = env("AI_API_KEY");
    model = env("AI_MODEL");
    baseUrl = env("AI_BASE_URL");
  } else {
    apiKey = env("OPENAI_API_KEY") || env("AI_API_KEY");
    model = env("OPENAI_MODEL") || env("AI_MODEL");
    baseUrl = env("AI_BASE_URL") || OPENAI_BASE_URL;
  }

  baseUrl = normalizeBaseUrl(baseUrl);
  const endpoint = baseUrl ? `${baseUrl}/responses` : "";

  return {
    provider,
    apiKey,
    model,
    baseUrl,
    endpoint,
    configured: Boolean(apiKey && model && endpoint)
  };
}

export function providerFailureDetail(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const candidate = body as { error?: { code?: unknown; type?: unknown } };
  const raw = candidate.error?.code || candidate.error?.type;
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 80);
}
