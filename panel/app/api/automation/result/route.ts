import { NextRequest, NextResponse } from "next/server";
import { isWorkerAuthorized } from "@/lib/auth";
import { finishBidSubmission } from "@/lib/store";
import { sendSubmissionResult } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id || !["submitted", "failed"].includes(body.status)) return NextResponse.json({ error: "Invalid result" }, { status: 400 });
  const approval = await finishBidSubmission(String(body.id), body.status, String(body.error || "").slice(0, 1000));
  if (!approval) return NextResponse.json({ error: "Submission claim not found" }, { status: 409 });
  await sendSubmissionResult(approval).catch(() => undefined);
  return NextResponse.json({ approval });
}
