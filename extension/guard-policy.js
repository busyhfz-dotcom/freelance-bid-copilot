(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CopilotGuard = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  function unsafeBid(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 1800) return true;
    if (/(?:^|\n)\s*(?:#{1,6}\s*|[-*]\s*)?\*{0,2}(?:internal[-_ ]notes?|analysis|reasoning|thoughts?|یادداشت[‌ ]داخلی|تحلیل داخلی|روند تفکر)\b\*{0,2}\s*[:：]?/im.test(text)) return true;
    return /here(?:'|’)s\s+(?:a\s+|the\s+)?(?:thinking|reasoning)\s+process|\bchain[- ]of[- ]thought\b|<\/?(?:think|reasoning|analysis)\b|(?:^|\n)\s*(?:[-*]\s*)?\*{0,2}(?:analysis|reasoning|input|title|brief|skills|constraints?|expected depth)\*{0,2}\s*[:：]/im.test(text);
  }

  function fillBlockReason(item = {}) {
    if ("bid" in item && unsafeBid(item.bid)) return "متن بید شامل یادداشت داخلی یا خروجی نامعتبر است؛ دوباره Generate Bid را اجرا کن.";
    if (item.domainGate === "blocked") return "این پروژه خارج از حوزه‌های کاری مجاز است و Fill برای آن مسدود شده است.";
    if (item.decision === "SKIP") return `Fill مسدود است: ${item.decisionReason || "پروژه یکی از گاردهای ایمنی را پاس نکرده است."}`;
    return "";
  }

  return { fillBlockReason, unsafeBid };
});
