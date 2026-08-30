type ApprovalTimestamp = { createdAt: string };

export function approvalDayKey(value: string | number | Date, timeZone = "Asia/Tehran") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function countApprovalsForDay(
  approvals: ApprovalTimestamp[],
  now: string | number | Date = new Date(),
  timeZone = "Asia/Tehran"
) {
  const today = approvalDayKey(now, timeZone);
  return approvals.filter((item) => approvalDayKey(item.createdAt, timeZone) === today).length;
}
