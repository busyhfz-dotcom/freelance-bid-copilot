import { NextRequest, NextResponse } from "next/server";
import { isWorkerAuthorized } from "@/lib/auth";
import { claimApprovedBid } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const workerId = String(body.workerId || "").trim().slice(0, 80);
  if (!workerId) return NextResponse.json({ error: "Missing workerId" }, { status: 400 });
  return NextResponse.json({ approval: await claimApprovedBid(workerId) });
}
