// Provider routing now happens explicitly in lib/bid.ts.
// Keep this hook intentionally side-effect free: patching global fetch caused
// explicit OpenAI fallback calls to be redirected back into the primary custom
// provider, which made independent provider failover impossible.
export function register() {
  // Next.js instrumentation entry point intentionally left as a no-op.
}
