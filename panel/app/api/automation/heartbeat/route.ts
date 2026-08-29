import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, isWorkerAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { listWorkerHeartbeats, saveWorkerHeartbeat } from "@/lib/store";
import { sendWorkerAlert } from "@/lib/telegram";
import type { WorkerHeartbeat } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (readsRequireAuthorization() && !isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ workers: await listWorkerHeartbeats() });
}

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  const value = await req.json().catch(() => null) as WorkerHeartbeat | null;
  if (!value?.workerId || !value.status) return NextResponse.json({ error: "Invalid heartbeat" }, { status: 400 });
  const heartbeat: WorkerHeartbeat = { ...value, workerId: String(value.workerId).slice(0, 80), lastSeenAt: new Date().toISOString() };
  const previous = (await listWorkerHeartbeats()).find((item) => item.workerId === heartbeat.workerId);
  await saveWorkerHeartbeat(heartbeat);
  const changedAlert = previous?.status !== heartbeat.status || previous?.message !== heartbeat.message;
  if (changedAlert && ["blocked", "error"].includes(heartbeat.status) && value.message) await sendWorkerAlert(heartbeat).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
