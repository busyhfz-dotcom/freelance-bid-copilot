import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, isWorkerAuthorized, readsRequireAuthorization } from "@/lib/auth";
import { createReport, type ReportInput } from "@/lib/reports";
import { listReports, saveReport } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (readsRequireAuthorization() && !isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ reports: await listReports(300) });
}

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as ReportInput | null;
  if (!body) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  try {
    const report = createReport(body);
    await saveReport(report);
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid report" },
      { status: 400 }
    );
  }
}

