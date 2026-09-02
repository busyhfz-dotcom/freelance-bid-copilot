import test from "node:test";
import assert from "node:assert/strict";
import { budgetAllowsApprovedPrice, parseBudgetRange, parseMoneyValues } from "../worker/src/budget-policy.mjs";

test("approved price remains valid when Ponisha expands a fixed maximum into a range", () => {
  assert.equal(budgetAllowsApprovedPrice("از ۵٬۰۰۰٬۰۰۰ تا ۱۰٬۰۰۰٬۰۰۰ تومان", "10,000,000 تومان"), true);
});

test("approved price is blocked when the fresh maximum is lower", () => {
  assert.equal(budgetAllowsApprovedPrice("از ۵٬۰۰۰٬۰۰۰ تا ۸٬۰۰۰٬۰۰۰ تومان", "10,000,000 تومان"), false);
});

test("Persian million shorthand and rial values normalize to toman", () => {
  assert.deepEqual(parseBudgetRange("۵ تا ۱۰ میلیون تومان"), { min: 5_000_000, max: 10_000_000 });
  assert.deepEqual(parseMoneyValues("۱۰۰٬۰۰۰٬۰۰۰ ریال"), [10_000_000]);
});

test("unknown budget never passes the submission guard", () => {
  assert.equal(budgetAllowsApprovedPrice("توافقی", "10,000,000 تومان"), false);
});
