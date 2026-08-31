import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const extension = require("../extension/domain-engine.js");
const panel = await import("../panel/lib/domain.ts");

const engines = [
  {
    name: "extension",
    match: (project, profile = "", preferredDomains = []) =>
      extension.matchProject(project, profile, preferredDomains)
  },
  {
    name: "panel",
    match: (project, profile = "", preferredDomains = []) =>
      panel.localDomainMatch({
        title: project.title || "",
        skills: project.skills,
        description: project.snippet || project.description || "",
        freelancerProfile: profile,
        preferredDomains
      })
  }
];

function canonical(result) {
  return {
    score: result.score,
    domainGate: result.domainGate,
    primaryDomain: result.primaryDomain,
    primaryDomainKey: result.primaryDomainKey,
    allowedDomains: result.allowedDomains,
    skillGaps: result.skillGaps,
    overlap: result.overlap
  };
}

function assertClassification({ project, profile = "", preferredDomains, primaryDomainKey, domainGate, maxScore }) {
  for (const engine of engines) {
    const result = engine.match(project, profile, preferredDomains);
    assert.equal(result.primaryDomainKey, primaryDomainKey, `${engine.name}: primary domain`);
    assert.equal(result.domainGate, domainGate, `${engine.name}: domain gate`);
    if (maxScore !== undefined) {
      assert.ok(result.score <= maxScore, `${engine.name}: score ${result.score} exceeds cap ${maxScore}`);
    }
  }
}

describe("Logo/Branding versus Web/UI regression", () => {
  test("logo deliverable stays Branding despite website context", () => {
    assertClassification({
      project: { title: "Logo design for a website", skills: ["Logo Design", "Figma"] },
      profile: "UI/UX and responsive web designer",
      primaryDomainKey: "branding",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("Persian logo deliverable stays Branding despite web context", () => {
    assertClassification({
      project: { title: "طراحی لوگو برای وب سایت فروشگاهی", skills: ["طراحی لوگو"] },
      profile: "طراح رابط کاربری و طراحی سایت",
      primaryDomainKey: "branding",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("existing logo is context, not the deliverable, in an English UI project", () => {
    assertClassification({
      project: { title: "Website UI redesign using the existing logo and brand identity", skills: ["UI/UX", "Figma"] },
      profile: "Logo and brand identity designer",
      primaryDomainKey: "web_ui",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("existing logo is context, not the deliverable, in a Persian UI project", () => {
    assertClassification({
      project: { title: "طراحی رابط کاربری سایت بر اساس لوگو و هویت بصری موجود", skills: ["رابط کاربری", "Figma"] },
      profile: "طراح لوگو و هویت بصری",
      primaryDomainKey: "web_ui",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("an explicit Branding deliverable wins over landing-page context", () => {
    assertClassification({
      project: { title: "Create a brand identity and logo for a SaaS landing page" },
      preferredDomains: ["web_ui"],
      primaryDomainKey: "branding",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("a new logo remains a deliverable in a website redesign", () => {
    assertClassification({
      project: { title: "Website redesign with a new logo" },
      preferredDomains: ["web_ui"],
      primaryDomainKey: "branding",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("zero-width Persian spacing does not hide a Branding deliverable", () => {
    assertClassification({
      project: { title: "طراحی هویت‌بصری برای وب‌سایت شرکت" },
      preferredDomains: ["web_ui"],
      primaryDomainKey: "branding",
      domainGate: "blocked",
      maxScore: 35
    });
  });
});

describe("Hard Domain Gate", () => {
  test("display labels from Worker environment resolve to internal domain keys", () => {
    assertClassification({
      project: { title: "Restaurant website UI design", skills: ["Responsive Design"] },
      preferredDomains: ["Web/UI", "WordPress/CMS"],
      primaryDomainKey: "web_ui",
      domainGate: "allowed"
    });
  });

  test("slash-separated profile terms infer Branding", () => {
    assertClassification({
      project: { title: "Modern logo design" },
      profile: "Logo/Branding designer",
      primaryDomainKey: "branding",
      domainGate: "allowed"
    });
  });

  test("explicit domains override contradictory profile text", () => {
    assertClassification({
      project: { title: "Logo and visual identity design" },
      profile: "Logo and brand identity designer",
      preferredDomains: ["web_ui"],
      primaryDomainKey: "branding",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("adjacent domain cannot become allowed", () => {
    assertClassification({
      project: { title: "Build a WordPress website with Elementor" },
      preferredDomains: ["web_ui"],
      primaryDomainKey: "wordpress",
      domainGate: "related",
      maxScore: 60
    });
  });

  test("recognized project is blocked when profile infers no domain", () => {
    assertClassification({
      project: { title: "Design a company logo" },
      profile: "Experienced freelancer focused on quality work",
      primaryDomainKey: "branding",
      domainGate: "blocked",
      maxScore: 35
    });
  });

  test("missing profile never returns a numeric Match", () => {
    for (const engine of engines) {
      const result = engine.match({ title: "Logo design" });
      assert.equal(result.domainGate, "profile_missing", engine.name);
      assert.equal(result.score, null, engine.name);
    }
  });

  test("malformed domain input fails closed instead of throwing", () => {
    for (const engine of engines) {
      const result = engine.match({ title: "Logo design" }, "", "web_ui");
      assert.equal(result.domainGate, "profile_missing", engine.name);
      assert.equal(result.score, null, engine.name);
    }
  });
});

describe("extension and panel matcher parity", () => {
  const fixtures = [
    [{ title: "Logo design for website", skills: ["Figma"] }, "UI UX web design", ["web_ui"]],
    [{ title: "Website UI based on existing logo", skills: ["UI/UX"] }, "brand identity logo", ["branding"]],
    [{ title: "WordPress Elementor landing page", skills: ["WordPress"] }, "web design", ["web_ui"]],
    [{ title: "React dashboard development", skills: ["React", "TypeScript"] }, "React frontend developer", []],
    [{ title: "طراحی لوگو برای اپلیکیشن", skills: ["لوگوتایپ"] }, "رابط کاربری اپلیکیشن", ["web_ui"]],
    [{ title: "طراحی رابط کاربری سایت با لوگوی فعلی", skills: ["فیگما"] }, "طراح لوگو", ["branding"]]
  ];

  for (const [index, [project, profile, preferredDomains]] of fixtures.entries()) {
    test(`fixture ${index + 1}`, () => {
      const extensionResult = canonical(engines[0].match(project, profile, preferredDomains));
      const panelResult = canonical(engines[1].match(project, profile, preferredDomains));
      assert.deepEqual(panelResult, extensionResult);
    });
  }
});
