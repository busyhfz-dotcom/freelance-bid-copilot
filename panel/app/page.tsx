"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BidApprovalRecord, ProjectPayload, ProjectRecord, SearchRecord, SearchResultItem, WorkerHeartbeat } from "@/lib/types";

type Marketplace = "kaya" | "ponisha";
type ViewMode = "browser" | "history" | "projects" | "automation";
type Notice = { kind: "success" | "error" | "info"; text: string } | null;

const MARKETPLACES: Record<Marketplace, { label: string; url: string; short: string }> = {
  kaya: { label: "کایا", url: "https://kaya.ir/", short: "KY" },
  ponisha: { label: "پونیشا", url: "https://ponisha.ir/", short: "PN" }
};
const DATA_REFRESH_INTERVAL = 45_000;
const AUTOMATION_REFRESH_INTERVAL = 5_000;

function Icon({ children }: { children: ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function relativeTime(value: string) {
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${minutes} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  return `${Math.floor(hours / 24)} روز پیش`;
}

function hostOf(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; }
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number, message: string) {
  let timer = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

export default function Page() {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const adapterBundleRef = useRef<Promise<{ revision: string; bundle: string }> | null>(null);
  const documentGenerationRef = useRef(0);
  const injectedGenerationRef = useRef(-1);
  const navigationRequestRef = useRef(0);
  const [desktop, setDesktop] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [browserStatus, setBrowserStatus] = useState("در انتظار کلاینت دسکتاپ");
  const [marketplace, setMarketplace] = useState<Marketplace>("kaya");
  const [address, setAddress] = useState(MARKETPLACES.kaya.url);
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [approvals, setApprovals] = useState<BidApprovalRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerHeartbeat[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [selectedSearch, setSelectedSearch] = useState<SearchRecord | null>(null);
  const [inspected, setInspected] = useState<ProjectPayload | null>(null);
  const [mode, setMode] = useState<ViewMode>("browser");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [intelCollapsed, setIntelCollapsed] = useState(false);
  const [accessKey, setAccessKey] = useState("change-me");
  const [panelUrl, setPanelUrl] = useState("");
  const [profile, setProfile] = useState("");
  const [domains, setDomains] = useState("Web/UI, WordPress/CMS");

  const headers = useMemo(() => ({ "Content-Type": "application/json", "X-Copilot-Key": accessKey }), [accessKey]);

  const refreshData = useCallback(async () => {
    try {
      const [projectResponse, searchResponse, approvalResponse, workerResponse] = await Promise.all([
        fetch("/api/projects", { headers, cache: "no-store" }),
        fetch("/api/searches", { headers, cache: "no-store" }),
        fetch("/api/automation/candidates", { headers, cache: "no-store" }),
        fetch("/api/automation/heartbeat", { headers, cache: "no-store" })
      ]);
      if ([projectResponse, searchResponse, approvalResponse, workerResponse].some((response) => response.status === 401)) {
        setNotice({ kind: "error", text: "کلید دسترسی پنل معتبر نیست." });
        return;
      }
      const [projectData, searchData, approvalData, workerData] = await Promise.all([
        projectResponse.json(), searchResponse.json(), approvalResponse.json(), workerResponse.json()
      ]);
      const nextProjects = projectData.projects || [];
      const nextSearches = searchData.searches || [];
      setProjects((current) => JSON.stringify(current) === JSON.stringify(nextProjects) ? current : nextProjects);
      setSearches((current) => JSON.stringify(current) === JSON.stringify(nextSearches) ? current : nextSearches);
      setApprovals((current) => JSON.stringify(current) === JSON.stringify(approvalData.approvals || []) ? current : approvalData.approvals || []);
      setWorkers((current) => JSON.stringify(current) === JSON.stringify(workerData.workers || []) ? current : workerData.workers || []);
      setSelectedProject((current) => current || nextProjects[0] || null);
      setSelectedSearch((current) => current || nextSearches[0] || null);
    } catch {
      setNotice({ kind: "error", text: "اتصال به API پنل برقرار نشد." });
    }
  }, [headers]);

  useEffect(() => {
    const savedKey = localStorage.getItem("bid-copilot:key");
    const savedProfile = localStorage.getItem("bid-copilot:profile");
    const savedDomains = localStorage.getItem("bid-copilot:domains");
    if (savedKey) setAccessKey(savedKey);
    if (savedProfile) setProfile(savedProfile);
    if (savedDomains) setDomains(savedDomains);
    const bridge = window.bidCopilotDesktop;
    setDesktop(Boolean(bridge?.isDesktop));
    if (bridge) {
      bridge.getSettings().then((settings) => {
        setPanelUrl(settings.panelUrl);
        setBrowserStatus("مرورگر امن آماده است");
      }).catch(() => setBrowserStatus("پل دسکتاپ در دسترس نیست"));
    }
    setConfigReady(true);
  }, []);

  useEffect(() => {
    if (!configReady) return;
    void refreshData();
  }, [configReady, refreshData]);

  useEffect(() => {
    if (!configReady || mode === "browser") return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshData();
    };
    const timer = window.setInterval(refreshWhenVisible, mode === "automation" ? AUTOMATION_REFRESH_INTERVAL : DATA_REFRESH_INTERVAL);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [configReady, mode, refreshData]);

  useEffect(() => {
    if (!desktop || !webviewRef.current) return;
    const view = webviewRef.current;
    const updateNavigationState = () => {
      try {
        setCanGoBack(view.canGoBack());
        setCanGoForward(view.canGoForward());
      } catch {
        setCanGoBack(false);
        setCanGoForward(false);
      }
    };
    const onReady = () => {
      setBrowserReady(true);
      setBrowserLoading(false);
      setBrowserStatus("متصل و آماده تحلیل");
      setAddress(view.getURL() || MARKETPLACES.kaya.url);
      updateNavigationState();
    };
    const onStart = () => {
      documentGenerationRef.current += 1;
      injectedGenerationRef.current = -1;
      setBrowserReady(false);
      setBrowserLoading(true);
      setBrowserStatus("در حال بارگذاری…");
    };
    const onStop = () => {
      setBrowserReady(true);
      setBrowserLoading(false);
      setBrowserStatus("متصل و آماده تحلیل");
      updateNavigationState();
    };
    const onNavigate = (event: Event) => {
      const next = (event as Event & { url?: string }).url || view.getURL();
      if (next) {
        setAddress(next);
        setInspected((current) => current?.url === next ? current : null);
      }
      updateNavigationState();
    };
    const onFail = (event: Event) => {
      const details = event as Event & { errorCode?: number };
      if (details.errorCode === -3) return;
      setBrowserReady(false);
      setBrowserLoading(false);
      setBrowserStatus("بارگذاری صفحه ناموفق بود");
    };
    view.addEventListener("dom-ready", onReady);
    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    view.addEventListener("did-navigate", onNavigate);
    view.addEventListener("did-navigate-in-page", onNavigate);
    view.addEventListener("did-fail-load", onFail);
    return () => {
      view.removeEventListener("dom-ready", onReady);
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
      view.removeEventListener("did-navigate", onNavigate);
      view.removeEventListener("did-navigate-in-page", onNavigate);
      view.removeEventListener("did-fail-load", onFail);
    };
  }, [desktop]);

  useEffect(() => {
    const bridge = window.bidCopilotDesktop;
    if (!bridge) return;
    return bridge.onFocusAddress(() => {
      setMode("browser");
      window.setTimeout(() => {
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
      }, 0);
    });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function waitForBrowserDocument(view: ElectronWebviewElement, milliseconds = 12_000) {
    try {
      if (!view.isLoading()) return;
    } catch {
      // The webview can briefly be attached before its guest is ready.
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("صفحه هنوز در حال بارگذاری است؛ Esc را بزن یا مرورگر را Refresh کن."));
      }, milliseconds);
      const finish = () => { cleanup(); resolve(); };
      const fail = (event: Event) => {
        const details = event as Event & { errorCode?: number };
        if (details.errorCode === -3) return;
        cleanup();
        reject(new Error("بارگذاری صفحه کامل نشد."));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        view.removeEventListener("dom-ready", finish);
        view.removeEventListener("did-stop-loading", finish);
        view.removeEventListener("did-fail-load", fail);
      };
      view.addEventListener("dom-ready", finish, { once: true });
      view.addEventListener("did-stop-loading", finish, { once: true });
      view.addEventListener("did-fail-load", fail);
    });
  }

  async function injectAdapters() {
    const view = webviewRef.current;
    const bridge = window.bidCopilotDesktop;
    if (!view || !bridge) throw new Error("مرورگر داخلی فقط در نسخه دسکتاپ فعال است.");
    await waitForBrowserDocument(view);
    if (injectedGenerationRef.current === documentGenerationRef.current) return view;
    if (!adapterBundleRef.current) adapterBundleRef.current = bridge.getAdapterScripts();
    const scripts = await adapterBundleRef.current;
    const marker = JSON.stringify(scripts.revision);
    const alreadyInjected = await view.executeJavaScript<boolean>(
      `Boolean(window.BidCopilotAdapter && window.__BID_COPILOT_ADAPTER_REVISION__ === ${marker})`
    );
    if (!alreadyInjected) {
      await view.executeJavaScript(`${scripts.bundle}\n;window.__BID_COPILOT_ADAPTER_REVISION__ = ${marker};`);
    }
    injectedGenerationRef.current = documentGenerationRef.current;
    return view;
  }

  async function navigateBrowser(url: string) {
    const view = webviewRef.current;
    let normalized = url.trim();
    if (normalized && !/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    setAddress(normalized);
    if (!view) {
      setNotice({ kind: "error", text: "مرورگر داخلی هنوز آماده نیست." });
      return;
    }
    const requestId = ++navigationRequestRef.current;
    try {
      if (view.getURL() === normalized) return;
      view.stop();
      await view.loadURL(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestId !== navigationRequestRef.current || /ERR_ABORTED|\(-3\)/i.test(message)) return;
      setNotice({ kind: "error", text: `بازکردن صفحه ناموفق بود: ${message}` });
    }
  }

  async function reloadBrowser() {
    setInspected(null);
    setBrowserReady(false);
    setBrowserStatus("در حال Refresh صفحه…");
    try {
      const reloaded = await window.bidCopilotDesktop?.reloadMarketplace();
      if (!reloaded) webviewRef.current?.reload();
    } catch {
      setNotice({ kind: "error", text: "Refresh صفحه انجام نشد؛ بازیابی کامل را بزن." });
    }
  }

  async function stopBrowser() {
    try {
      const stopped = await window.bidCopilotDesktop?.stopMarketplace();
      if (!stopped) webviewRef.current?.stop();
      setBrowserLoading(false);
      setBrowserStatus("بارگذاری متوقف شد");
    } catch {
      webviewRef.current?.stop();
    }
  }

  async function recoverBrowser() {
    setBusy(null);
    setInspected(null);
    setBrowserReady(false);
    setBrowserStatus("در حال بازیابی مرورگر…");
    try {
      const recovered = await window.bidCopilotDesktop?.recoverMarketplace();
      if (!recovered) {
        webviewRef.current?.stop();
        webviewRef.current?.reloadIgnoringCache();
      }
      setNotice({ kind: "success", text: "مرورگر داخلی بازیابی و Refresh شد." });
    } catch {
      setNotice({ kind: "error", text: "بازیابی مرورگر انجام نشد؛ از Refresh Workspace استفاده کن." });
    }
  }

  function refreshWorkspace() {
    if (window.bidCopilotDesktop) {
      void window.bidCopilotDesktop.reloadWorkspace();
    } else {
      window.location.reload();
    }
  }

  function switchMarketplace(next: Marketplace) {
    setMarketplace(next);
    setQuery("");
    setInspected(null);
    void navigateBrowser(MARKETPLACES[next].url);
  }

  async function runSearch() {
    const view = webviewRef.current;
    if (!view || !desktop) {
      setNotice({ kind: "info", text: "برای جست‌وجوی لاگین‌شده، کلاینت دسکتاپ را اجرا کن." });
      return;
    }
    const raw = query.trim();
    if (!raw) return;
    if (/^https?:\/\//i.test(raw)) {
      await navigateBrowser(raw);
      return;
    }
    setBusy("search");
    try {
      const result = await view.executeJavaScript<{ ok: boolean; reason?: string }>(`(() => {
        const q = ${JSON.stringify(raw)};
        const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
        const selectors = [
          "input[type='search']", "input[name*='search' i]", "input[placeholder*='جستجو']",
          "input[placeholder*='جست‌وجو']", "input[placeholder*='مهارت']", "input[placeholder*='project' i]",
          "input[placeholder*='search' i]"
        ];
        const input = selectors.flatMap((s) => [...document.querySelectorAll(s)]).find(visible);
        if (!input) return { ok: false, reason: 'کادر جست‌وجوی سایت پیدا نشد؛ از نوار آدرس یا جست‌وجوی خود سایت استفاده کن.' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, q);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const form = input.closest('form');
        if (form?.requestSubmit) form.requestSubmit();
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        return { ok: true };
      })()`);
      if (!result.ok) throw new Error(result.reason);
      setNotice({ kind: "success", text: `جست‌وجوی «${raw}» داخل ${MARKETPLACES[marketplace].label} اجرا شد.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "جست‌وجو انجام نشد." });
    } finally {
      setBusy(null);
    }
  }

  async function scanAndSave() {
    setBusy("scan");
    setBrowserStatus("در حال استخراج فهرست پروژه‌ها…");
    try {
      const view = await injectAdapters();
      const scan = await withTimeout(
        view.executeJavaScript<{ ok: boolean; site: string; pageUrl: string; count: number; items: SearchResultItem[] }>(
          "window.BidCopilotAdapter.scanList()"
        ),
        10_000,
        "استخراج فهرست بیش از ۱۰ ثانیه طول کشید؛ بارگذاری را متوقف و دوباره امتحان کن."
      );
      if (!scan?.ok) throw new Error("این صفحه به‌عنوان فهرست پروژه شناسایی نشد.");
      const response = await fetch("/api/searches", {
        method: "POST",
        headers,
        body: JSON.stringify({ site: scan.site, query, pageUrl: scan.pageUrl, results: scan.items })
      });
      if (!response.ok) throw new Error(response.status === 401 ? "کلید دسترسی پنل معتبر نیست." : "ذخیره نتایج ناموفق بود.");
      const saved = await response.json() as SearchRecord;
      setSearches((current) => [saved, ...current]);
      setSelectedSearch(saved);
      setMode("history");
      setNotice({ kind: "success", text: `${scan.count} پروژه استخراج و در تاریخچه ذخیره شد.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "اسکن صفحه انجام نشد." });
    } finally {
      setBusy(null);
      if (browserReady) setBrowserStatus("متصل و آماده تحلیل");
    }
  }

  async function readCurrentProject() {
    setBrowserStatus("در حال خواندن پروژه…");
    const view = await injectAdapters();
    return withTimeout(
      view.executeJavaScript<ProjectPayload>("window.BidCopilotAdapter.inspect()"),
      8000,
      "خواندن صفحه در ۸ ثانیه تمام نشد؛ Esc را بزن، سپس Refresh صفحه را امتحان کن."
    );
  }

  async function inspectCurrentProject() {
    setBusy("inspect");
    try {
      const payload = await readCurrentProject();
      setInspected(payload);
      setNotice({ kind: "success", text: "صفحه پروژه با آداپتر امن خوانده شد." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "تحلیل صفحه ناموفق بود." });
    } finally {
      setBusy(null);
      if (browserReady) setBrowserStatus("متصل و آماده تحلیل");
    }
  }

  async function generateFromPayload(payload: ProjectPayload) {
    const response = await fetch("/api/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...payload,
          freelancerProfile: profile,
          preferredDomains: domains.split(",").map((item) => item.trim()).filter(Boolean)
        })
      });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "تولید بید ناموفق بود.");
    const record = result as ProjectRecord;
    setProjects((current) => [record, ...current.filter((item) => item.url !== record.url)]);
    setSelectedProject(record);
    setMode("projects");
    return record;
  }

  async function generateBid() {
    if (!inspected) return;
    setBusy("generate");
    try {
      await generateFromPayload(inspected);
      setNotice({ kind: "success", text: "تحلیل، Hard Domain Gate و بید ذخیره شد." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "تولید بید ناموفق بود." });
    } finally {
      setBusy(null);
    }
  }

  async function quickAnalyze() {
    setBusy("workflow");
    try {
      const payload = await readCurrentProject();
      setInspected(payload);
      await generateFromPayload(payload);
      setNotice({ kind: "success", text: "Inspect، تحلیل و تولید بید در یک مرحله انجام شد." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "تحلیل سریع ناموفق بود." });
    } finally {
      setBusy(null);
      if (browserReady) setBrowserStatus("متصل و آماده تحلیل");
    }
  }

  async function fillBid() {
    if (!selectedProject || selectedProject.decision !== "BID" || !selectedProject.guardReady) {
      setNotice({ kind: "error", text: "Fill فقط برای BID با Guard آماده مجاز است." });
      return;
    }
    setBusy("fill");
    try {
      const view = await injectAdapters();
      await view.executeJavaScript("window.BidCopilotAdapter.openProposalForm()");
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      const fill = await view.executeJavaScript<{ ok: boolean; reason?: string }>(`window.BidCopilotAdapter.fill(${JSON.stringify({
        bid: selectedProject.bid,
        price: selectedProject.recommendedPrice,
        duration: selectedProject.recommendedDuration
      })})`);
      if (!fill.ok) throw new Error(fill.reason || "فرم پیدا نشد.");
      await fetch("/api/projects", { method: "PATCH", headers, body: JSON.stringify({ url: selectedProject.url, status: "filled" }) });
      setProjects((current) => current.map((item) => item.url === selectedProject.url ? { ...item, status: "filled" } : item));
      setSelectedProject({ ...selectedProject, status: "filled" });
      setNotice({ kind: "success", text: "فرم داخل مرورگر پر شد؛ ارسال نهایی همچنان دستی است." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Fill انجام نشد." });
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    localStorage.setItem("bid-copilot:key", accessKey);
    localStorage.setItem("bid-copilot:profile", profile);
    localStorage.setItem("bid-copilot:domains", domains);
    if (desktop && panelUrl && window.bidCopilotDesktop) {
      await window.bidCopilotDesktop.setPanelUrl(panelUrl);
    }
    setSettingsOpen(false);
    setNotice({ kind: "success", text: "تنظیمات ذخیره شد." });
    refreshData();
  }

  function openResult(result: SearchResultItem) {
    setMode("browser");
    setInspected(null);
    void navigateBrowser(result.url);
  }

  const activeResultCount = selectedSearch?.results.length || 0;
  const highValueCount = projects.filter((item) => (item.jobScore || 0) >= 70 && item.decision === "BID").length;
  const pendingApprovalCount = approvals.filter((item) => item.status === "pending" || item.status === "approved").length;
  const workerOnline = workers.some((worker) => Date.now() - new Date(worker.lastSeenAt).getTime() < 90_000);
  const busyLabel = busy === "workflow" ? "Inspect، امتیازدهی و تولید بید…" : busy === "inspect" ? "در حال خواندن و تحلیل DOM…" : busy === "scan" ? "در حال استخراج پروژه‌های صفحه…" : busy === "search" ? "در حال اجرای جست‌وجو…" : busy === "generate" ? "در حال ساخت تصمیم و بید…" : busy === "fill" ? "در حال تکمیل فرم امن…" : "";

  return (
    <main className="workspace" dir="rtl">
      <aside className="rail">
        <div className="brandMark">B<span>•</span></div>
        <nav aria-label="ناوبری اصلی">
          <button className={mode === "browser" ? "active" : ""} onClick={() => setMode("browser")} title="مرورگر"><Icon>⌁</Icon><small>مرورگر</small></button>
          <button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")} title="جست‌وجوها"><Icon>⌕</Icon><small>جست‌وجو</small></button>
          <button className={mode === "projects" ? "active" : ""} onClick={() => setMode("projects")} title="پروژه‌ها"><Icon>▤</Icon><small>پروژه‌ها</small></button>
          <button className={mode === "automation" ? "active" : ""} onClick={() => setMode("automation")} title="اتوماسیون"><Icon>⚡</Icon><small>اتوماسیون</small></button>
        </nav>
        <button className="railSettings" onClick={() => setSettingsOpen(true)} title="تنظیمات"><Icon>⚙</Icon></button>
      </aside>

      <section className="appSurface">
        <header className="appHeader">
          <div className="titleBlock"><div className="productLine"><span className="pulse" /> BID COPILOT <b>WORKSPACE</b></div><h1>{mode === "browser" ? "مرورگر پروژه‌ها" : mode === "history" ? "تاریخچه جست‌وجو" : mode === "projects" ? "پروژه‌های تحلیل‌شده" : "صف تأیید و Worker آنلاین"}</h1></div>
          <div className="headerMetrics"><div><span>PROJECTS</span><strong>{projects.length}</strong></div><div><span>APPROVALS</span><strong>{pendingApprovalCount}</strong></div><div><span>WORKER</span><strong className={workerOnline ? "green" : ""}>{workerOnline ? "ON" : "OFF"}</strong></div></div>
          <div className="runtimeGroup"><div className={`runtimePill ${desktop ? "online" : "web"}`}><span />{desktop ? "Desktop bridge" : "Web dashboard"}</div><button className="workspaceRefresh" onClick={refreshWorkspace} title="Refresh کامل Workspace">↻ Refresh app</button></div>
        </header>

        <div className={`mainGrid ${intelCollapsed ? "intelCollapsed" : ""}`}>
          <section className="primaryPane">
            <div className={mode === "browser" ? "browserCard" : "browserCard browserHidden"}>
                <div className="browserTopline">
                  <div className="traffic"><i /><i /><i /></div>
                  <div className="siteTabs">{(Object.keys(MARKETPLACES) as Marketplace[]).map((site) => <button key={site} className={marketplace === site ? "active" : ""} onClick={() => switchMarketplace(site)}><span>{MARKETPLACES[site].short}</span>{MARKETPLACES[site].label}</button>)}</div>
                  <div className="browserState"><span className={browserReady ? "ready" : ""} />{browserStatus}</div>
                </div>
                <div className="browserToolbar" dir="ltr">
                  <div className="navButtons"><button onClick={() => webviewRef.current?.goBack()} disabled={!canGoBack} aria-label="بازگشت">‹</button><button onClick={() => webviewRef.current?.goForward()} disabled={!canGoForward} aria-label="جلو">›</button><button className={browserLoading ? "stopButton" : "reloadButton"} onClick={() => browserLoading ? void stopBrowser() : void reloadBrowser()} aria-label={browserLoading ? "توقف بارگذاری" : "Refresh صفحه"} title={browserLoading ? "توقف بارگذاری (Esc)" : "Refresh سریع صفحه"}>{browserLoading ? "×" : "↻"}</button><button className="recoverButton" onClick={recoverBrowser} aria-label="بازیابی کامل مرورگر" title="بازیابی کامل و حذف cache صفحه (F5)">⟳</button></div>
                  <div className="addressBar"><span>⌾</span><input ref={addressInputRef} value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void navigateBrowser(address); }} /><kbd>CTRL L</kbd><em>{hostOf(address)}</em></div>
                  <button className="inspectButton" onClick={inspectCurrentProject} disabled={!desktop || !browserReady || busy !== null}>{busy === "inspect" ? "…" : "Inspect"}</button>
                </div>
                <div className="searchCommand">
                  <div className="searchField"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && runSearch()} placeholder={`جست‌وجوی پروژه یا مهارت داخل ${MARKETPLACES[marketplace].label}…`} /><kbd>ENTER</kbd></div>
                  <button onClick={runSearch} disabled={busy !== null}>جست‌وجو</button>
                  <button className="accentButton" onClick={scanAndSave} disabled={!desktop || !browserReady || busy !== null}>{busy === "scan" ? "در حال استخراج…" : "استخراج و ذخیره"}</button>
                </div>
                <div className="browserViewport" dir="ltr">
                  {desktop ? <webview ref={(node) => { webviewRef.current = node as unknown as ElectronWebviewElement | null; }} src={MARKETPLACES.kaya.url} partition="persist:bid-copilot" /> : (
                    <div className="desktopRequired" dir="rtl"><div className="desktopGlyph"><span>⌁</span></div><p className="overline">SECURE SESSION REQUIRED</p><h2>مرورگر لاگین‌شده در کلاینت دسکتاپ باز می‌شود</h2><p>داشبورد وب برای تاریخچه و مدیریت داده‌هاست. نسخه Electron همین پنل را با session پایدار کایا و پونیشا در یک پنجره اجرا می‌کند.</p><div className="securityRow"><span>● Session محلی</span><span>● بدون انتقال Cookie</span><span>● Hard Domain Gate</span></div></div>
                  )}
                  {busyLabel && <div className="browserActivity" dir="rtl"><span /><strong>{busyLabel}</strong><button onClick={() => void stopBrowser()}>توقف</button></div>}
                </div>
              </div>

            {mode === "history" && (
              <div className="dataView">
                <div className="dataHeader"><div><span className="overline">SEARCH ARCHIVE</span><h2>جست‌وجوهای ذخیره‌شده</h2></div><button onClick={refreshData}>↻ همگام‌سازی</button></div>
                <div className="splitData">
                  <div className="recordList">
                    {searches.length === 0 && <div className="zeroState">هنوز جست‌وجویی ذخیره نشده است.</div>}
                    {searches.map((search) => <button key={search.id} className={selectedSearch?.id === search.id ? "record active" : "record"} onClick={() => setSelectedSearch(search)}><span className="recordLogo">{MARKETPLACES[search.site as Marketplace]?.short || search.site.slice(0, 2).toUpperCase()}</span><span><strong>{search.query || "اسکن مستقیم صفحه"}</strong><small>{search.resultCount} نتیجه • {relativeTime(search.searchedAt)}</small></span><b>›</b></button>)}
                  </div>
                  <div className="resultTable">
                    <div className="tableTitle"><span>{selectedSearch?.query || "آخرین نتایج"}</span><b>{activeResultCount} PROJECTS</b></div>
                    <div className="tableRows">
                      {selectedSearch?.results.map((result, index) => <button key={`${result.url}-${index}`} className="resultRow" onClick={() => openResult(result)}><span className="rank">{String(index + 1).padStart(2, "0")}</span><span className="resultMain"><strong>{result.title}</strong><small>{result.budget || "بودجه نامشخص"} {result.age ? `• ${result.age}` : ""}</small></span><span className="resultDomain">{result.primaryDomain || "UNCLASSIFIED"}</span><span className="rowAction">باز کردن ↗</span></button>)}
                      {!selectedSearch && <div className="zeroState">یک جست‌وجو را انتخاب کن.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {mode === "projects" && (
              <div className="dataView">
                <div className="dataHeader"><div><span className="overline">DECISION LEDGER</span><h2>پروژه‌ها و بیدهای ثبت‌شده</h2></div><button onClick={refreshData}>↻ همگام‌سازی</button></div>
                <div className="projectLedger">
                  {projects.length === 0 && <div className="zeroState">هنوز پروژه‌ای تحلیل و ذخیره نشده است.</div>}
                  {projects.map((project) => <button key={project.id} className={selectedProject?.id === project.id ? "ledgerRow active" : "ledgerRow"} onClick={() => setSelectedProject(project)}><span className={`decision ${project.decision?.toLowerCase() || "maybe"}`}>{project.decision || "MAYBE"}</span><span className="ledgerTitle"><strong>{project.title}</strong><small>{project.site} • {relativeTime(project.capturedAt)}</small></span><span><small>JOB</small><strong>{project.jobScore ?? "—"}%</strong></span><span><small>MATCH</small><strong>{project.matchScore ?? "—"}%</strong></span><span><small>DOMAIN</small><strong>{project.primaryDomain || "—"}</strong></span><span className="statusTag">{project.status}</span></button>)}
                </div>
              </div>
            )}

            {mode === "automation" && (
              <div className="dataView automationView">
                <div className="dataHeader"><div><span className="overline">ALWAYS-ON CONTROL PLANE</span><h2>صف تأیید تلگرام و ثبت خودکار</h2></div><button onClick={refreshData}>↻ همگام‌سازی</button></div>
                <div className="automationBody">
                  <section className="workerStrip">
                    {workers.length === 0 && <div className="zeroState">هنوز Worker متصل نشده است.</div>}
                    {workers.map((worker) => {
                      const online = Date.now() - new Date(worker.lastSeenAt).getTime() < 90_000;
                      return <article key={worker.workerId} className={`workerCard ${online ? "online" : "offline"}`}><span className="workerLight" /><div><strong>{worker.workerId}</strong><small>{online ? "آنلاین" : "قطع"} · {worker.status} · {relativeTime(worker.lastSeenAt)}</small></div><p>{worker.message || "بدون پیام"}</p><div className="sessionBadges">{Object.entries(worker.sessionState || {}).map(([site, state]) => <span key={site} className={state === "ready" ? "ready" : "blocked"}>{site}: {state}</span>)}</div></article>;
                    })}
                  </section>
                  <section className="approvalQueue">
                    {approvals.length === 0 && <div className="zeroState">هنوز بیدی برای تأیید تلگرام آماده نشده است.</div>}
                    {approvals.map((approval) => <button key={approval.id} className="approvalRow" onClick={() => { setSelectedProject(approval.project); }}>
                      <span className={`approvalState ${approval.status}`}>{approval.status}</span>
                      <span className="approvalTitle"><strong>{approval.title}</strong><small>{approval.site} · {relativeTime(approval.createdAt)} · اعتبار تا {new Date(approval.expiresAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}</small></span>
                      <span><small>JOB</small><strong>{approval.score}%</strong></span>
                      <span><small>PRICE</small><strong>{approval.project.recommendedPrice || "—"}</strong></span>
                      <span><small>DELIVERY</small><strong>{approval.project.recommendedDuration || "—"} روز</strong></span>
                      <span className="telegramState">{approval.telegramMessageId ? "Telegram ✓" : "در انتظار ارسال"}</span>
                    </button>)}
                  </section>
                </div>
              </div>
            )}
          </section>

          <aside className="intelPane">
            <button className="intelToggle" onClick={() => setIntelCollapsed((value) => !value)} title={intelCollapsed ? "بازکردن پنل تحلیل" : "جمع‌کردن پنل تحلیل"}>{intelCollapsed ? "‹" : "›"}</button>
            <div className="intelContent">
            <div className="intelHeader"><div><span className="overline">LIVE INTELLIGENCE</span><h2>{inspected?.title || selectedProject?.title || "صفحه‌ای برای تحلیل انتخاب نشده"}</h2></div><span className={`decisionBadge ${(selectedProject?.decision || "MAYBE").toLowerCase()}`}>{selectedProject?.decision || "REVIEW"}</span></div>
            <div className="scoreGrid"><div><span>JOB SCORE</span><strong>{selectedProject?.jobScore ?? "—"}<small>%</small></strong></div><div><span>MATCH</span><strong>{selectedProject?.matchScore ?? "—"}<small>%</small></strong></div><div><span>BID QUALITY</span><strong>{selectedProject?.bidQualityScore ?? "—"}<small>%</small></strong></div></div>
            <div className="gateCard"><div className="gateTitle"><span><i /> HARD DOMAIN GATE</span><b>{selectedProject?.domainGate || "WAITING"}</b></div><div className="gatePath"><span>DETECTED</span><strong>{selectedProject?.primaryDomain || "—"}</strong><em>→</em><span>PROFILE</span><strong>{selectedProject?.allowedDomains?.join(" · ") || domains || "—"}</strong></div><p>{selectedProject?.decisionReason || "بعد از Inspect و تولید بید، نتیجه Gate و دلیل تصمیم اینجا نمایش داده می‌شود."}</p></div>
            {inspected && selectedProject?.url !== inspected.url && <div className="inspectionCard"><span className="overline">INSPECTED PAGE</span><h3>{inspected.title}</h3><p>{inspected.description?.slice(0, 180) || "شرح پروژه شناسایی نشد."}</p><div className="miniMeta"><span>{inspected.budget || "بودجه نامشخص"}</span><span>{inspected.skills?.length || 0} مهارت</span></div></div>}
            <div className="bidCard"><div className="bidCardHead"><span>PROPOSAL DRAFT</span><b>{selectedProject?.recommendedPrice || "—"} / {selectedProject?.recommendedDuration ? `${selectedProject.recommendedDuration} روز` : "—"}</b></div><textarea readOnly value={selectedProject?.bid || "بعد از Inspect، دکمه «تحلیل و تولید بید» را بزن. نسخه نهایی فقط پس از عبور از Match Engine و Hard Domain Gate ساخته می‌شود."} /></div>
            <div className="intelActions"><button onClick={inspectCurrentProject} disabled={!desktop || !browserReady || busy !== null}>{busy === "inspect" ? "در حال خواندن…" : "فقط Inspect"}</button><button className="accentButton" onClick={inspected ? generateBid : quickAnalyze} disabled={!desktop || !browserReady || busy !== null}>{busy === "workflow" ? "در حال تحلیل کامل…" : busy === "generate" ? "در حال تولید بید…" : inspected ? "تحلیل و تولید بید" : "تحلیل سریع: Inspect + Bid"}</button><button className="fillButton" onClick={fillBid} disabled={!desktop || selectedProject?.decision !== "BID" || !selectedProject?.guardReady || busy !== null}>{busy === "fill" ? "در حال Fill…" : "Approve → Fill"}</button></div>
            <div className="safetyNote"><span>●</span> Submit داخل Electron دستی است؛ Worker آنلاین فقط پس از تأیید تلگرام و بازبینی تازهٔ Guard ثبت می‌کند.</div>
            </div>
          </aside>
        </div>

        <footer className="statusBar" dir="ltr"><span><i className={workerOnline ? "online" : ""} /> WORKER {workerOnline ? "ONLINE" : "OFFLINE"}</span><span>API {accessKey ? "KEYED" : "LOCKED"}</span><span>QUEUE {pendingApprovalCount}</span><span className="spacer" /><span>TELEGRAM APPROVAL REQUIRED</span><span>FRESH GUARD BEFORE SUBMIT</span><span>v0.5.1</span></footer>
      </section>

      {notice && <div className={`toast ${notice.kind}`}>{notice.text}</div>}
      {settingsOpen && <div className="modalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}><section className="settingsModal"><div className="modalHead"><div><span className="overline">WORKSPACE CONFIG</span><h2>تنظیمات اتصال و پروفایل</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></div><label>کلید دسترسی API<input type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="COPILOT_KEY" /></label><label>آدرس پنل روی دامنه<input dir="ltr" value={panelUrl} onChange={(event) => setPanelUrl(event.target.value)} placeholder="https://panel.example.com" /></label><label>پروفایل فریلنسر<textarea value={profile} onChange={(event) => setProfile(event.target.value)} placeholder="مهارت‌ها، سابقه و نوع پروژه‌های مطلوب…" /></label><label>حوزه‌های مجاز Hard Domain Gate<input dir="ltr" value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="Web/UI, WordPress/CMS" /></label><p>در هاست، دیتابیس و کلیدها Secret سرور هستند. نشست Electron روی سیستم و نشست Worker فقط در Volume خصوصی Worker می‌ماند؛ Cookie وارد API یا دیتابیس نمی‌شود.</p><button className="saveSettings" onClick={saveSettings}>ذخیره تنظیمات</button></section></div>}
    </main>
  );
}
