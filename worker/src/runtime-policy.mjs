export function describeWorkerError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "Unknown worker error").trim();
  if (name === "AbortError" || /operation was aborted|request aborted|timed?\s*out|timeout/i.test(message)) {
    return "Worker request timed out; the current operation stopped safely";
  }
  return message || "Unknown worker error";
}

export function blockedRetryDelayMs(value) {
  const minutes = Number(value);
  const bounded = Number.isFinite(minutes) ? Math.min(240, Math.max(5, Math.floor(minutes))) : 15;
  return bounded * 60_000;
}
