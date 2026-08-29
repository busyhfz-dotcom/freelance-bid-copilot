(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CopilotGuard = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  function fillBlockReason(item = {}) {
    if (item.domainGate === "blocked") return "این پروژه خارج از حوزه‌های کاری مجاز است و Fill برای آن مسدود شده است.";
    if (item.decision === "SKIP") return `Fill مسدود است: ${item.decisionReason || "پروژه یکی از گاردهای ایمنی را پاس نکرده است."}`;
    return "";
  }

  return { fillBlockReason };
});
