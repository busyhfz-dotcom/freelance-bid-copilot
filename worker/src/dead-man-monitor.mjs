// Monotonic elapsed time prevents clock corrections from causing restart storms.
import { performance } from "node:perf_hooks";

export function createDeadManMonitor({ timeoutMs = 900_000, scanIntervalMs = 120_000,
  cycleTimeoutMs = 480_000, now = () => performance.now(), wallNow = () => Date.now() } = {}) {
  const started = now();
  // Allow one complete scheduled cycle when operators configure slower polling.
  const effectiveTimeoutMs = Math.max(timeoutMs, scanIntervalMs + cycleTimeoutMs);
  let successfulAt = null;
  let completedAt = null;
  let activeAt = null;
  let lastSuccessfulScanAt = "";
  let lastCycleCompletedAt = "";
  let successfulSites = [];
  return {
    startCycle() { activeAt = now(); },
    completeCycle(sites = []) {
      completedAt = now();
      lastCycleCompletedAt = new Date(wallNow()).toISOString();
      if (sites.length) {
        successfulAt = completedAt;
        lastSuccessfulScanAt = lastCycleCompletedAt;
        successfulSites = [...sites];
      }
    },
    endCycle() { activeAt = null; },
    snapshot() {
      const time = now();
      const successAgeMs = Math.max(0, time - (successfulAt ?? started));
      const cycleAgeMs = Math.max(0, time - (completedAt ?? started));
      const activeCycleAgeMs = activeAt === null ? null : Math.max(0, time - activeAt);
      const reason = activeCycleAgeMs !== null && activeCycleAgeMs >= cycleTimeoutMs
        ? "scan_watchdog_restart"
        : cycleAgeMs >= effectiveTimeoutMs ? "scan_progress_stale"
        : successAgeMs >= effectiveTimeoutMs ? "scan_success_stale" : null;
      return { reason, stale: reason !== null, lastSuccessfulScanAt, lastCycleCompletedAt,
        successAgeMs, cycleAgeMs, activeCycleAgeMs, successfulSites: [...successfulSites],
        timeoutMs: effectiveTimeoutMs, configuredTimeoutMs: timeoutMs, cycleTimeoutMs };
    }
  };
}
