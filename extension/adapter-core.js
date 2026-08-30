(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BidCopilotAdapterCore = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const normalizeDigits = (value = "") => String(value || "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");

  const amount = "[0-9][0-9,.]*";
  const currencyCode = "(?:USD|AUD|CAD|NZD|SGD|HKD|INR|EUR|GBP|دلار|تومان|ریال)";
  const currencySymbol = "[$€£₹]";

  function cleanMatch(value = "") {
    return value.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();
  }

  function extractBudget(value = "") {
    const sample = normalizeDigits(value);
    const patterns = [
      new RegExp(`از\\s*(${amount})\\s*(?:تومان|ریال)?\\s*تا\\s*(${amount})\\s*(تومان|ریال)`, "i"),
      new RegExp(`(${amount})\\s*(?:تومان|ریال)?\\s*تا\\s*(${amount})\\s*(تومان|ریال)`, "i"),
      new RegExp(`(?:project\\s*)?(?:budget(?:\\s*range)?|بودجه|مبلغ\\s*پروژه)\\s*[:：]?\\s*((?:${currencySymbol}\\s*)?${amount}(?:\\s*(?:–|—|-|to|تا)\\s*(?:${currencySymbol}\\s*)?${amount})?\\s*${currencyCode}?)`, "i"),
      new RegExp(`(${currencySymbol}\\s*${amount}\\s*(?:–|—|-|to)\\s*(?:${currencySymbol}\\s*)?${amount}(?:\\s*${currencyCode})?)`, "i"),
      new RegExp(`(${amount}\\s*${currencyCode}\\s*(?:–|—|-|to)\\s*${amount}(?:\\s*${currencyCode})?)`, "i")
    ];
    for (let i = 0; i < patterns.length; i += 1) {
      const match = sample.match(patterns[i]);
      if (!match) continue;
      if (i <= 1) return cleanMatch(`${match[1]} تا ${match[2]} ${match[3] || ""}`);
      return cleanMatch(match[1] || "");
    }
    return "";
  }

  function explicitProposalCountFromText(value = "") {
    const lines = normalizeDigits(value)
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const candidates = [];
    for (const line of lines) {
      if (!/(پیشنهاد|بید|proposals?|bids?)/i.test(line)) continue;
      if (/(مورد نیاز|ویژه|ظرفیت|زمان باقی|ارسال پیشنهاد در|remaining|needed|required|left|available)/i.test(line)) continue;
      const patterns = [
        /(?:پیشنهاد(?:های)?\s*(?:ارسال|ثبت|دریافت)\s*شده|تعداد\s*پیشنهاد(?:ها)?(?:ی\s*(?:ارسال|ثبت)\s*شده)?|proposals? received|bids? received)[^0-9]{0,24}([0-9]{1,4})/i,
        /([0-9]{1,4})\s*(?:پیشنهاد|بید|proposals?|bids?)\s*(?:ارسال|ثبت|دریافت)\s*شده/i,
        /(?:proposals?|bids?)\s*[:：]?\s*([0-9]{1,4})\b/i,
        /\b([0-9]{1,4})\s*(?:proposals?|bids?)\b/i
      ];
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) candidates.push(Number(match[1]));
      }
    }
    const valid = candidates.filter((count) => Number.isFinite(count) && count >= 0 && count <= 999);
    return valid.length ? Math.min(...valid) : null;
  }

  function fieldRoleScore(kind, metadata = {}) {
    const identity = normalizeDigits(metadata.identity || "").toLowerCase();
    const context = normalizeDigits(metadata.context || "").toLowerCase();
    const priceSignal = /(?:amount|price|bid(?:\s*amount)?|budget|usd|aud|cad|nzd|sgd|hkd|inr|eur|gbp|\$|€|£|₹|مبلغ|قیمت|بودجه|تومان|ریال)/i;
    const durationSignal = /(?:delivery\s*time|delivery|duration|days?|زمان\s*تحویل|مدت|روز)/i;
    let score = 0;
    if (kind === "price") {
      if (priceSignal.test(identity)) score += 16;
      if (durationSignal.test(identity)) score -= 20;
      if (priceSignal.test(context)) score += 5;
      if (durationSignal.test(context)) score -= 7;
      if (/(پرداخت\s*امن|صندوق|درصد|%|قسط|مایلستون|milestone)/i.test(context)) score -= 18;
    } else {
      if (durationSignal.test(identity)) score += 20;
      if (priceSignal.test(identity)) score -= 20;
      if (durationSignal.test(context)) score += 6;
      if (priceSignal.test(context)) score -= 7;
    }
    return score;
  }

  function isMarketplaceProjectDetailUrl(pageHostname = "", href = "") {
    try {
      const host = String(pageHostname || "").toLowerCase();
      const url = new URL(href, `https://${host}/`);
      if (url.hostname.toLowerCase() !== host) return false;
      if (host === "kaya.ir" || host.endsWith(".kaya.ir")) return /^\\/jobs\\/\\d+\\/?$/.test(url.pathname);
      return true;
    } catch {
      return false;
    }
  }

  return { normalizeDigits, extractBudget, explicitProposalCountFromText, fieldRoleScore, isMarketplaceProjectDetailUrl };
});
