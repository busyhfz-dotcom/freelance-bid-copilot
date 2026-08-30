export type AlertEntry = {
  active: boolean;
  fingerprint: string;
  status: "blocked" | "error";
  message: string;
  lastSentAt: string;
  recoveredAt?: string;
};

export type AlertState = Record<string, AlertEntry>;

type AlertHeartbeat = {
  status: string;
  message?: string;
  currentSite?: string;
  sessionState?: Record<string, string>;
};

export type AlertDecision = {
  alertState: AlertState;
  action: "none" | "alert" | "recovered";
  site: string;
};

function normalizedFingerprint(status: string, site: string, message: string) {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  return `${status}|${site || "_worker"}|${normalized}`;
}

export function evaluateWorkerAlert(
  previousState: AlertState | undefined,
  heartbeat: AlertHeartbeat,
  nowMs: number,
  cooldownMs: number
): AlertDecision {
  const alertState: AlertState = { ...(previousState || {}) };
  const site = String(heartbeat.currentSite || "").trim().toLowerCase();
  const key = site || "_worker";
  const previous = alertState[key];

  if ((heartbeat.status === "blocked" || heartbeat.status === "error") && heartbeat.message) {
    const status = heartbeat.status;
    const message = String(heartbeat.message).trim();
    const fingerprint = normalizedFingerprint(status, site, message);
    const lastSentMs = previous ? Date.parse(previous.lastSentAt) : Number.NaN;
    const cooldownExpired = !Number.isFinite(lastSentMs) || nowMs - lastSentMs >= cooldownMs;
    const shouldAlert = !previous?.active || previous.fingerprint !== fingerprint || cooldownExpired;
    alertState[key] = {
      active: true,
      fingerprint,
      status,
      message,
      lastSentAt: shouldAlert ? new Date(nowMs).toISOString() : previous.lastSentAt
    };
    return { alertState, action: shouldAlert ? "alert" : "none", site };
  }

  const siteRecovered = Boolean(site && heartbeat.sessionState?.[site] === "ready");
  const workerRecovered = Boolean(!site && heartbeat.status === "idle" && previous?.active);
  if (previous?.active && (siteRecovered || workerRecovered)) {
    alertState[key] = { ...previous, active: false, recoveredAt: new Date(nowMs).toISOString() };
    return { alertState, action: "recovered", site };
  }

  return { alertState, action: "none", site };
}
