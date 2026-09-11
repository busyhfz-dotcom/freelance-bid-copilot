export type CompetitionLevel = "low" | "medium" | "high" | "unknown";
export type BidDecision = "BID" | "MAYBE" | "SKIP";

export type ProjectPayload = {
  id?: string;
  site: string;
  url: string;
  title: string;
  description: string;
  budget?: string;
  skills?: string[];
  clientInfo?: string;
  freelancerProfile?: string;
  preferredDomains?: string[];
  proposalCount?: number | null;
  competitionLevel?: CompetitionLevel;
  proposalCountSource?: "explicit" | "visible_cards" | "section_signals" | "unknown";
  competitionConfidence?: "high" | "medium" | "low";
  capturedAt?: string;
};

export type ProjectRecord = ProjectPayload & {
  id: string;
  capturedAt: string;
  bid: string;
  cleanedBrief?: string;
  recommendedPrice?: string;
  recommendedDuration?: string;
  matchScore?: number | null;
  matchReason?: string;
  domainGate?: "allowed" | "related" | "blocked" | "unknown" | "profile_missing";
  primaryDomain?: string;
  allowedDomains?: string[];
  skillGaps?: string[];
  budgetFitScore?: number;
  briefQualityScore?: number;
  competitionScore?: number;
  competitionLevel?: CompetitionLevel;
  bidQualityScore?: number;
  jobScore?: number;
  priceWithinBudget?: boolean;
  riskFlags?: string[];
  guardReady?: boolean;
  decision?: BidDecision;
  decisionReason?: string;
  status: "generated" | "filled" | "submitted" | "error";
};

export type SearchResultItem = {
  title: string;
  url: string;
  site?: string;
  budget?: string;
  age?: string;
  snippet?: string;
  skills?: string[];
  score?: number;
  matchScore?: number;
  domainGate?: string;
  primaryDomain?: string;
};

export type SearchRecord = {
  id: string;
  site: string;
  query: string;
  pageUrl: string;
  resultCount: number;
  searchedAt: string;
  results: SearchResultItem[];
};

export type ApprovalStatus =
  | "notified"
  | "project_pending"
  | "bid_pending"
  | "approved"
  | "rejected"
  | "expired"
  | "submitting"
  | "submitted"
  | "failed";

export type BidApprovalRecord = {
  id: string;
  projectId: string;
  url: string;
  site: string;
  title: string;
  status: ApprovalStatus;
  score: number;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  submittedAt?: string;
  claimedBy?: string;
  claimedAt?: string;
  telegramChatId?: string;
  telegramMessageId?: number;
  bidTelegramMessageId?: number;
  projectApprovedAt?: string;
  bidApprovedAt?: string;
  approvalTokenHash: string;
  attempts: number;
  lastError?: string;
  project: ProjectRecord;
};

export type WorkerHeartbeat = {
  workerId: string;
  status: "starting" | "idle" | "scanning" | "submitting" | "blocked" | "error";
  lastSeenAt: string;
  lastScanAt?: string;
  currentSite?: string;
  sessionState?: Record<string, "ready" | "login_required" | "captcha" | "error">;
  message?: string;
  version?: string;
  alertState?: Record<string, WorkerAlertEntry>;
};

export type WorkerAlertEntry = {
  active: boolean;
  fingerprint: string;
  status: "blocked" | "error";
  message: string;
  lastSentAt: string;
  recoveredAt?: string;
};

export type ReportCategory = "scan" | "telegram" | "worker" | "bid" | "system";
export type ReportLevel = "info" | "success" | "warning" | "error";

export type ReportRecord = {
  id: string;
  category: ReportCategory;
  eventType: string;
  level: ReportLevel;
  title: string;
  message: string;
  createdAt: string;
  site?: string;
  workerId?: string;
  approvalId?: string;
  projectId?: string;
  projectTitle?: string;
  status?: string;
  metadata?: Record<string, string | number | boolean | null>;
};
