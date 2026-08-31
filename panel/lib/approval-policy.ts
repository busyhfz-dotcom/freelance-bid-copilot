import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { BidApprovalRecord, ProjectRecord } from "./types";

export type TelegramDecision = "approve" | "reject";

export function createApprovalToken() {
  const token = randomBytes(12).toString("base64url");
  return { token, hash: hashApprovalToken(token) };
}

export function hashApprovalToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashApprovalToken(token), "hex");
  const expected = Buffer.from(expectedHash || "", "hex");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

export function approvalId(project: ProjectRecord) {
  return createHash("sha256").update(`${project.id}|${project.url}|${Date.now()}|${randomBytes(4).toString("hex")}`).digest("hex").slice(0, 16);
}

export function canQueueForApproval(project: ProjectRecord, minimumScore = 72) {
  const guardedBid = project.decision === "BID" && project.guardReady === true;
  const safeManualReview = project.decision === "MAYBE"
    && project.domainGate === "allowed"
    && project.priceWithinBudget === true
    && (project.bidQualityScore || 0) >= 70;
  return (guardedBid || safeManualReview)
    && project.priceWithinBudget === true
    && (project.jobScore || 0) >= minimumScore
    && Boolean(project.bid && project.recommendedPrice && project.recommendedDuration);
}

export function isApprovalFresh(record: BidApprovalRecord, now = Date.now()) {
  return new Date(record.expiresAt).getTime() > now;
}

export function parseTelegramDecision(value: string) {
  const match = /^(a|r):([a-f0-9]{16}):([A-Za-z0-9_-]{16})$/.exec(value || "");
  if (!match) return null;
  return {
    decision: (match[1] === "a" ? "approve" : "reject") as TelegramDecision,
    approvalId: match[2],
    token: match[3]
  };
}

export function callbackData(decision: TelegramDecision, id: string, token: string) {
  return `${decision === "approve" ? "a" : "r"}:${id}:${token}`;
}
