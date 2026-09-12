import assert from "node:assert/strict";
import test from "node:test";
import { blockedCountry, canonicalProjectUrl, projectSeenKeys } from "../worker/src/candidate-policy.mjs";

test("canonical URL removes tracking noise", () => {
  assert.equal(canonicalProjectUrl("https://Example.com/jobs/42/?utm_source=x&ref=mail#top"), "https://example.com/jobs/42");
});

test("same project title produces a stable duplicate key", () => {
  const first = projectSeenKeys({ site: "ponisha", url: "https://ponisha.ir/p/1", title: " طراحی  سایت فروشگاهی " });
  const second = projectSeenKeys({ site: "ponisha", url: "https://ponisha.ir/p/2", title: "طراحی سایت فروشگاهی" });
  assert.equal(first[1], second[1]);
});

test("blocks configured employer countries only from client metadata", () => {
  for (const country of ["Pakistan", "Bangladeshi", "India", "پاکستان", "بنگلادش", "هند"]) {
    assert.equal(blockedCountry({ clientInfo: `Verified employer, ${country}` }), true);
  }
  assert.equal(blockedCountry({ clientInfo: "Verified employer, Germany", description: "India travel website" }), false);
});
