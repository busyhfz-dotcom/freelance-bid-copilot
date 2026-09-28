import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const worker = fs.readFileSync(path.resolve(import.meta.dirname, "../worker/src/index.mjs"), "utf8");
const guardSource = worker.slice(worker.indexOf("function hasBlock("), worker.indexOf("async function pageBlock("));
const hasBlock = new Function(`${guardSource}\nreturn hasBlock;`)();

test("project listing content cannot masquerade as a login or CAPTCHA screen", () => {
  const listing = "لیست پروژه‌ها\nتعداد یافته ها: 403 پروژه\n" + "آگهی جدید\n".repeat(160) + "ورود به حساب و کپچا در شرح پروژه";
  assert.equal(hasBlock(listing, "https://ponisha.ir/search/projects"), "");
  assert.equal(hasBlock("ورود به حساب در شرح پروژه", "https://ponisha.ir/search/projects"), "login_required");
  assert.equal(hasBlock("", "https://ponisha.ir/login"), "login_required");
  assert.equal(hasBlock("", "https://ponisha.ir/captcha"), "captcha");
});

test("paused markets are excluded from scans and the notification outbox", () => {
  assert.match(worker, /for \(const site of enabledMarkets\)/);
  assert.match(worker, /pendingNotifications\.filter\(\(project\) => enabledMarkets\.has\(project\.site\)\)/);
  assert.match(worker, /notification outbox: dropped/);
});
