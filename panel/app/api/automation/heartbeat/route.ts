import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, isWorkerAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { createReport } from "@/lib/reports";
import { listWorkerHeartbeats, saveReport, saveWorkerHeartbeat } from "@/lib/store";
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
  if (decision.action === "alert" || decision.action === "recovered") {
    const recovered = decision.action === "recovered";
    await saveReport(createReport({
      category: "worker",
      eventType: recovered ? "worker_recovery" : "worker_alert",
      level: recovered ? "success" : "warning",
      title: recovered ? "اتصال Worker بازیابی شد" : "هشدار Worker",
      message: heartbeat.message || heartbeat.status,
      site: decision.site || heartbeat.currentSite,
      workerId,
      status: heartbeat.status,
      metadata: {
        telegramDelivered: false,
        kayaSession: heartbeat.sessionState?.kaya || null,
        ponishaSession: heartbeat.sessionState?.ponisha || null
      }
    }));
  }
  return NextResponse.json({ ok: true });
}
