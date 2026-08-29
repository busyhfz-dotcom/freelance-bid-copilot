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
});
