import assert from "node:assert/strict";
import test from "node:test";
import { enforceProposalStyle, parseBudget, recommendedPriceForBudget } from "../panel/lib/bid-utils.ts";
import { canonicalProjectUrl, comesFromBlockedCountry, projectFingerprint } from "../panel/lib/candidate-policy.ts";

const project = {
  site: "ponisha",
  url: "https://ponisha.ir/project/42",
  title: "طراحی رابط کاربری داشبورد فروش",
  description: "طراحی رابط کاربری داشبورد فروش با نمودارها و نسخه موبایل",
  budget: "۵ تا ۱۰ میلیون تومان"
};

test("panel parses Persian shorthand budgets and recommends a competitive in-range price", () => {
  assert.deepEqual(parseBudget(project.budget), { min: 5_000_000, max: 10_000_000, currency: "تومان" });
  const price = parseBudget(recommendedPriceForBudget(project.budget, "medium"));
  assert.ok(price.max >= 5_000_000 && price.max <= 10_000_000, `unexpected price ${price.max}`);
});

test("single advertised budget is treated as a ceiling and never exceeded", () => {
  const price = parseBudget(recommendedPriceForBudget("۱۰ میلیون تومان", "high"));
  assert.ok(price.max > 0 && price.max <= 10_000_000);
});

test("proposal post-processing removes generic openings, template headings and extra paragraphs", () => {
  const styled = enforceProposalStyle("با سلام، دوست عزیز\n\nTools & Software Stack\n\nخروجی داشبورد را ابتدا به‌صورت نسخه قابل بررسی آماده می‌کنم.\n\nجزئیات دوم.\n\nجزئیات سوم.\n\nجزئیات چهارم.");
  assert.doesNotMatch(styled, /با سلام|Tools & Software Stack/i);
  assert.ok(styled.split(/\n\s*\n/).length <= 4);
  assert.ok(styled.length <= 900);
  assert.match(styled, /داشبورد/);
});

test("country policy only reads client metadata", () => {
  assert.equal(comesFromBlockedCountry({ clientLocation: "Lahore, Pakistan", description: "German website" }), true);
  assert.equal(comesFromBlockedCountry({ clientLocation: "Berlin, Germany", description: "India travel portal" }), false);
});

test("panel canonical URL and title fingerprint suppress tracking variants and reposts", () => {
  assert.equal(canonicalProjectUrl("https://Ponisha.ir/project/42/?utm_source=email#bid"), "https://ponisha.ir/project/42");
  assert.equal(
    projectFingerprint({ site: "ponisha", title: " طراحی‌ رابط کاربری " }),
    projectFingerprint({ site: "ponisha", title: "طراحی رابط کاربری" })
  );
});
