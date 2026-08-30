import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeProjectInspection } from "../worker/src/project-normalizer.mjs";

describe("Worker project inspection fallback", () => {
  test("uses the list title and URL when a hydrated Kaya page has no title yet", () => {
    const result = normalizeProjectInspection({
      site: "kaya",
      item: {
        site: "kaya",
        title: "طراحی رابط کاربری داشبورد",
        url: "https://kaya.ir/jobs/40678789",
        snippet: "طراحی و پیاده‌سازی داشبورد مدیریتی",
        budget: "۱۰ تا ۲۰ میلیون تومان",
        skills: ["UI/UX"]
      },
      inspected: { site: "kaya", title: "", url: "", description: "", skills: [] }
    });

    assert.equal(result.title, "طراحی رابط کاربری داشبورد");
    assert.equal(result.url, "https://kaya.ir/jobs/40678789");
    assert.equal(result.description, "طراحی و پیاده‌سازی داشبورد مدیریتی");
    assert.equal(result.budget, "۱۰ تا ۲۰ میلیون تومان");
    assert.deepEqual(result.skills, ["UI/UX"]);
  });

  test("keeps richer detail-page values when inspection succeeds", () => {
    const result = normalizeProjectInspection({
      site: "kaya",
      item: { title: "عنوان فهرست", url: "https://kaya.ir/jobs/1", skills: ["WordPress"] },
      inspected: { title: "عنوان دقیق", url: "https://kaya.ir/jobs/1", description: "شرح دقیق", skills: ["React"] }
    });

    assert.equal(result.title, "عنوان دقیق");
    assert.equal(result.description, "شرح دقیق");
    assert.deepEqual(result.skills, ["React"]);
  });

  test("falls back to the browser URL when the listing URL is absent", () => {
    const result = normalizeProjectInspection({
      site: "kaya",
      item: { title: "پروژه آزمایشی" },
      inspected: null,
      currentUrl: "https://kaya.ir/jobs/2"
    });

    assert.equal(result.url, "https://kaya.ir/jobs/2");
    assert.equal(result.title, "پروژه آزمایشی");
  });

  test("falls back to the listing title when Kaya detail metadata is only a site suffix", () => {
    const result = normalizeProjectInspection({
      site: "kaya",
      item: { title: "طراحی سایت وردپرس", url: "https://kaya.ir/jobs/3" },
      inspected: { title: "| گروه", url: "https://kaya.ir/jobs/3" }
    });

    assert.equal(result.title, "طراحی سایت وردپرس");
  });

  test("removes the Kaya site suffix from a valid detail title", () => {
    const result = normalizeProjectInspection({
      site: "kaya",
      item: { title: "عنوان فهرست", url: "https://kaya.ir/jobs/4" },
      inspected: { title: "پیاده‌سازی داشبورد | گروه کایا", url: "https://kaya.ir/jobs/4" }
    });

    assert.equal(result.title, "پیاده‌سازی داشبورد");
  });

  test("rejects a project when both detail and listing titles are placeholders", () => {
    const result = normalizeProjectInspection({
      site: "kaya",
      item: { title: "| گروه", url: "https://kaya.ir/jobs/5" },
      inspected: { title: "گروه کایا", url: "https://kaya.ir/jobs/5" }
    });

    assert.equal(result.title, "");
  });
});
