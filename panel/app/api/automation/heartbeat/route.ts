import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, isWorkerAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { listWorkerHeartbeats, saveWorkerHeartbeat } from "@/lib/store";
import { sendWorkerAlert, sendWorkerRecovery } from "@/lib/telegram";
import type { WorkerHeartbeat } from "@/lib/types";
import { evaluateWorkerAlert } from "@/lib/worker-alert-policy";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (readsRequireAuthorization() && !isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ workers: await listWorkerHeartbeats() });
}

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  const value = await req.json().catch(() => null) as WorkerHeartbeat | null;
  if (!value?.workerId || !value.status) return NextResponse.json({ error: "Invalid heartbeat" }, { status: 400 });
  const workerId = String(value.workerId).slice(0, 80);
  const previous = (await listWorkerHeartbeats()).find((item) => item.workerId === workerId);
  const cooldownMinutes = Math.min(1440, Math.max(5, Number(process.env.WORKER_ALERT_COOLDOWN_MINUTES) || 30));
  const decision = evaluateWorkerAlert(previous?.alertState, value, Date.now(), cooldownMinutes * 60_000);
  const heartbeat: WorkerHeartbeat = {
    ...value,
    workerId,
    lastSeenAt: new Date().toISOString(),
    alertState: decision.alertState
  };
  await saveWorkerHeartbeat(heartbeat);
  const workerAlertsEnabled = process.env.TELEGRAM_WORKER_ALERTS_ENABLED === "true";
  if (workerAlertsEnabled && decision.action === "alert") await sendWorkerAlert(heartbeat).catch(() => undefined);
  if (workerAlertsEnabled && decision.action === "recovered") await sendWorkerRecovery(heartbeat, decision.site).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
