import { randomUUID } from "node:crypto";
import type { ReportCategory, ReportLevel, ReportRecord } from "./types";

export type ReportInput = Omit<ReportRecord, "id" | "createdAt" | "category" | "level" | "eventType" | "title" | "message"> & {
  id?: string;
  createdAt?: string;
  category: ReportCategory;
  level?: ReportLevel;
  eventType: string;
  title: string;
  message: string;
};

const categories = new Set<ReportCategory>(["scan", "telegram", "worker", "bid", "system"]);
const levels = new Set<ReportLevel>(["info", "success", "warning", "error"]);

function text(value: unknown, maximum: number) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function safeMetadata(value: ReportInput["metadata"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 30)) {
    const key = text(rawKey, 80);
    if (!key || /token|secret|password|cookie|authorization/i.test(key)) continue;
    if (rawValue === null || ["string", "number", "boolean"].includes(typeof rawValue)) {
      result[key] = typeof rawValue === "string" ? text(rawValue, 1000) : rawValue as number | boolean | null;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function createReport(input: ReportInput): ReportRecord {
  if (!categories.has(input.category)) throw new Error("Invalid report category");
  const eventType = text(input.eventType, 100);
  const title = text(input.title, 240);
  const message = text(input.message, 4000);
  if (!eventType || !title || !message) throw new Error("Incomplete report");
  const level = input.level && levels.has(input.level) ? input.level : "info";
  return {
    id: text(input.id, 120) || randomUUID(),
    category: input.category,
    eventType,
    level,
    title,
    message,
    createdAt: input.createdAt && Number.isFinite(new Date(input.createdAt).getTime())
      ? new Date(input.createdAt).toISOString()
      : new Date().toISOString(),
    site: text(input.site, 40) || undefined,
    workerId: text(input.workerId, 80) || undefined,
    approvalId: text(input.approvalId, 120) || undefined,
    projectId: text(input.projectId, 120) || undefined,
    projectTitle: text(input.projectTitle, 240) || undefined,
    status: text(input.status, 80) || undefined,
    metadata: safeMetadata(input.metadata)
  };
}

