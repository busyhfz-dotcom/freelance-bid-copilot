import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const adapterCore = require("../extension/adapter-core.js");
const guardPolicy = require("../extension/guard-policy.js");
const bidPolicy = await import("../panel/lib/bid-policy.ts");

describe("Kaya budget parsing", () => {
  test("extracts a labelled USD budget range", () => {
    assert.equal(adapterCore.extractBudget("Project Budget: $250.00 – $750.00 USD"), "$250.00 – $750.00 USD");
  });

  test("extracts a range when the second amount repeats no symbol", () => {
    assert.equal(adapterCore.extractBudget("$250 - 750 USD"), "$250 - 750 USD");
  });

  test("extracts a fixed labelled budget", () => {
    assert.equal(adapterCore.extractBudget("Budget 800 USD"), "800 USD");
  });

  test("does not treat the proposal Amount placeholder as employer budget", () => {
    assert.equal(adapterCore.extractBudget("Send Your Proposal Amount (USD) $ 800 Delivery Time (Days) 30"), "");
  });
});

describe("Kaya form field roles", () => {
  test("recognizes Amount (USD) as price", () => {
    const meta = { identity: "amount usd $ 800", context: "Send Your Proposal Amount (USD)" };
    assert.ok(adapterCore.fieldRoleScore("price", meta) > 0);
    assert.ok(adapterCore.fieldRoleScore("duration", meta) < 0);
  });

  test("recognizes Delivery Time (Days) as duration", () => {
    const meta = { identity: "delivery time days 30", context: "Delivery Time (Days)" };
    assert.ok(adapterCore.fieldRoleScore("duration", meta) > 0);
    assert.ok(adapterCore.fieldRoleScore("price", meta) < 0);
  });
});

describe("Kaya competition parsing", () => {
  test("accepts compact English bid counts", () => {
    assert.equal(adapterCore.explicitProposalCountFromText("Project details\nBids: 12\nSend Your Proposal"), 12);
  });

  test("ignores remaining-bid quotas", () => {
    assert.equal(adapterCore.explicitProposalCountFromText("20 bids remaining"), null);
  });
});

describe("manual review policy when Kaya hides budget", () => {
  test("missing budget becomes MAYBE rather than a false out-of-budget SKIP", () => {
    const result = bidPolicy.decisionFor({
      matchScore: 70,
      domainGate: "allowed",
      jobScore: 66,
      quality: 98,
      budgetKnown: false,
      budgetWithin: false,
      competitionKnown: false
    });
    assert.equal(result.decision, "MAYBE");
    assert.match(result.reason, /بودجه/);
  });

  test("a verified out-of-budget price remains SKIP", () => {
    const result = bidPolicy.decisionFor({
      matchScore: 80,
      domainGate: "allowed",
      jobScore: 80,
      quality: 90,
      budgetKnown: true,
      budgetWithin: false,
      competitionKnown: true
    });
    assert.equal(result.decision, "SKIP");
  });
});

describe("Fill block reasons", () => {
  test("reports the actual SKIP reason for an in-profile project", () => {
    assert.equal(
      guardPolicy.fillBlockReason({ domainGate: "allowed", decision: "SKIP", decisionReason: "قیمت پیشنهادی داخل بودجه قابل تأیید نیست." }),
      "Fill مسدود است: قیمت پیشنهادی داخل بودجه قابل تأیید نیست."
    );
  });

  test("keeps the domain-specific reason for blocked domains", () => {
    assert.match(guardPolicy.fillBlockReason({ domainGate: "blocked", decision: "SKIP" }), /خارج از حوزه/);
  });
});
