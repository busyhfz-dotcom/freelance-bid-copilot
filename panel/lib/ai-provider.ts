export type AIProviderName = "openai" | "groq" | "openrouter" | "custom";

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
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
const OPENROUTER_DEFAULT_MODEL = "openrouter/free";
export const OPENROUTER_FREE_FALLBACK_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-s-2.1:free",
  "inclusionai/ling-3.0-flash:free"
];

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function providerConfig(
  provider: AIProviderName,
  apiKey: string,
  model: string,
  baseUrl: string
): AIProviderConfig {
  const normalized = normalizeBaseUrl(baseUrl);
  const effectiveProvider: AIProviderName = provider === "custom" && /openrouter\.ai/i.test(normalized)
    ? "openrouter"
    : provider;
  return {
    provider: effectiveProvider,
    apiKey,
    model,
    baseUrl: normalized,
    endpoint: normalized ? `${normalized}/responses` : "",
    configured: Boolean(apiKey && model && normalized)
  };
}

function primaryProviderName(): AIProviderName {
  const explicit = env("AI_PROVIDER").toLowerCase();
  if (explicit === "groq" || explicit === "openai" || explicit === "openrouter" || explicit === "custom") return explicit;
  if (env("GROQ_API_KEY")) return "groq";
  if (env("OPENROUTER_API_KEY")) return "openrouter";
  if (env("OPENAI_API_KEY")) return "openai";
  return "custom";
}

function configFor(provider: AIProviderName): AIProviderConfig {
  if (provider === "groq") {
    return providerConfig(
      "groq",
      env("GROQ_API_KEY"),
      env("GROQ_MODEL") || GROQ_DEFAULT_MODEL,
      env("GROQ_BASE_URL") || GROQ_BASE_URL
    );
  }
  if (provider === "openrouter") {
    return providerConfig(
      "openrouter",
      env("OPENROUTER_API_KEY"),
      env("OPENROUTER_MODEL") || OPENROUTER_DEFAULT_MODEL,
      env("OPENROUTER_BASE_URL") || OPENROUTER_BASE_URL
    );
  }
  if (provider === "custom") {
    return providerConfig(
      "custom",
      env("AI_API_KEY"),
      env("AI_MODEL"),
      env("AI_BASE_URL")
    );
  }
  return providerConfig(
    "openai",
    env("OPENAI_API_KEY"),
    env("OPENAI_MODEL"),
    env("OPENAI_BASE_URL") || OPENAI_BASE_URL
  );
}

export function resolveAIProvider(): AIProviderConfig {
  return configFor(primaryProviderName());
}

export function resolveAIProviders(): AIProviderConfig[] {
  const primary = primaryProviderName();
  const allowOpenAIFallback = env("OPENAI_FALLBACK_ENABLED").toLowerCase() === "true";
  const requested = (env("AI_FALLBACK_ORDER") || "groq,openrouter,custom")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is AIProviderName =>
      value === "groq" || value === "openrouter" || value === "custom" || value === "openai"
    )
    .filter((value) => value !== "openai" || primary === "openai" || allowOpenAIFallback);

  const order: AIProviderName[] = [primary, ...requested.filter((item) => item !== primary)];
  const seen = new Set<string>();
  const providers: AIProviderConfig[] = [];
  for (const name of order) {
    const config = configFor(name);
    if (!config.configured) continue;
    const key = `${config.provider}|${config.baseUrl}|${config.model}|${config.apiKey.slice(0, 8)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    providers.push(config);
  }
  return providers;
}

export function providerFailureDetail(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const candidate = body as { error?: { code?: unknown; type?: unknown } };
  const raw = candidate.error?.code || candidate.error?.type;
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 80);
}
