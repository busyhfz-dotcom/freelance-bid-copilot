export type PolicyDomainGate = "allowed" | "related" | "blocked" | "unknown" | "profile_missing";
export type PolicyDecision = "BID" | "MAYBE" | "SKIP";

export function decisionFor(input: {
  matchScore: number | null;
  domainGate: PolicyDomainGate;
  jobScore: number;
  quality: number;
  budgetKnown: boolean;
  budgetWithin: boolean;
  competitionKnown: boolean;
}): { decision: PolicyDecision; reason: string } {
  const { matchScore, domainGate, jobScore, quality, budgetKnown, budgetWithin, competitionKnown } = input;
  if (domainGate === "blocked") return { decision: "SKIP", reason: "حوزه اصلی پروژه خارج از حوزه‌های کاری مجاز است." };
  if (budgetKnown && !budgetWithin) return { decision: "SKIP", reason: "قیمت پیشنهادی خارج از بودجه اعلام‌شده پروژه است." };
  if (quality < 70) return { decision: "SKIP", reason: "کیفیت متن بید پایین‌تر از حد امن است." };
  if (matchScore !== null && matchScore < 50) return { decision: "SKIP", reason: "تطبیق مهارتی با پروژه پایین است." };
  if (jobScore < 55) return { decision: "SKIP", reason: "امتیاز کلی پروژه پایین است." };
  if (domainGate === "related") return { decision: "MAYBE", reason: "حوزه پروژه به تخصص‌های شما نزدیک است اما تطبیق مستقیم نیست؛ بررسی دستی لازم است." };
  if (domainGate === "unknown") return { decision: "MAYBE", reason: "حوزه اصلی پروژه با اطمینان کافی تشخیص داده نشده است." };
  if (domainGate === "profile_missing") return { decision: "MAYBE", reason: "پروفایل یا حوزه کاری برای تصمیم BID کامل نیست." };
  if (!budgetKnown) return { decision: "MAYBE", reason: "بودجه پروژه در صفحه قابل تشخیص نیست؛ قیمت را پیش از Fill دستی بررسی کنید." };
  if (matchScore !== null && matchScore >= 70 && jobScore >= 72 && quality >= 80 && competitionKnown && domainGate === "allowed") {
    return { decision: "BID", reason: "حوزه پروژه مجاز است و تطبیق، بودجه، کیفیت بید و رقابت برای ارسال مناسب‌اند." };
  }
  if (!competitionKnown) return { decision: "MAYBE", reason: "رقابت هنوز با اطمینان تشخیص داده نشده؛ قبل از ارسال بررسی شود." };
  if (matchScore === null) return { decision: "MAYBE", reason: "پروفایل مهارتی برای تصمیم BID کامل نیست." };
  return { decision: "MAYBE", reason: "پروژه قابل بررسی است اما یکی از امتیازهای اصلی هنوز در محدوده متوسط است." };
}
