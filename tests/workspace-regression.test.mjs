import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Electron shell isolates the hosted panel from Node.js", () => {
  const main = read("desktop/main.cjs");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webviewTag:\s*true/);
  assert.match(main, /persist:bid-copilot/);
});

test("embedded browser navigation is limited to Kaya and Ponisha", () => {
  const main = read("desktop/main.cjs");
  assert.match(main, /\["kaya\.ir", "ponisha\.ir"\]/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /will-navigate/);
  assert.match(main, /isMarketplaceUrl/);
});

test("desktop preload exposes only the narrow workspace bridge", () => {
  const preload = read("desktop/preload.cjs");
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /getAdapterScripts/);
  assert.doesNotMatch(preload, /require:\s*require/);
  assert.doesNotMatch(preload, /process:\s*process/);
});

test("workspace includes browser, search archive, and project ledger", () => {
  const page = read("panel/app/page.tsx");
  assert.match(page, /<webview/);
  assert.match(page, /scanAndSave/);
  assert.match(page, /\/api\/searches/);
  assert.match(page, /تاریخچه جست‌وجو/);
  assert.match(page, /پروژه‌های تحلیل‌شده/);
  assert.doesNotMatch(page, /BidCopilotAdapter\.submit/);
  assert.match(page, /quickAnalyze/);
  assert.match(page, /تحلیل سریع: Inspect \+ Bid/);
});

test("hosted store uses PostgreSQL and retains a local development fallback", () => {
  const store = read("panel/lib/store.ts");
  assert.match(store, /process\.env\.DATABASE_URL/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS bid_copilot\.copilot_searches/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS bid_copilot\.copilot_projects/);
  assert.match(store, /CREATE SCHEMA IF NOT EXISTS bid_copilot/);
  assert.match(store, /searches\.json/);
  assert.match(store, /projects\.json/);
});

test("workspace API protects reads and writes with the panel key", () => {
  const searches = read("panel/app/api/searches/route.ts");
  const projects = read("panel/app/api/projects/route.ts");
  assert.match(searches, /readsRequireAuthorization\(\)/);
  assert.match(searches, /!isAuthorized\(req\)/);
  assert.match(projects, /readsRequireAuthorization\(\)/);
  assert.match(projects, /!isAuthorized\(req\)/);
});

test("Ponisha competition fallback avoids an all-div layout scan", () => {
  const adapters = read("extension/adapters.js");
  const headingBlock = adapters.slice(adapters.indexOf("function proposalListHeading"), adapters.indexOf("function looksLikeProposalCard"));
  const cardsBlock = adapters.slice(adapters.indexOf("function visibleProposalCards"), adapters.indexOf("function competitionLevel"));
  assert.doesNotMatch(headingBlock, /span,div/);
  assert.doesNotMatch(cardsBlock, /\[class\*='item'\],div/);
  assert.match(cardsBlock, /depth < 6/);
});

test("workspace waits for a real browser document and keeps DOM work bounded", () => {
  const page = read("panel/app/page.tsx");
  assert.match(page, /waitForBrowserDocument/);
  assert.match(page, /10_000/);
  assert.match(page, /8000/);
  assert.match(page, /خواندن صفحه در ۸ ثانیه تمام نشد/);
  assert.doesNotMatch(page, /injectAdapters\(\), 4000/);
});

test("adapter source is cached and injected as one bundle per document", () => {
  const main = read("desktop/main.cjs");
  const page = read("panel/app/page.tsx");
  assert.match(main, /adapterBundlePromise/);
  assert.match(main, /bundle: `\$\{core\}\\n\$\{adapters\}`/);
  assert.match(page, /adapterBundleRef/);
  assert.match(page, /injectedGenerationRef/);
  assert.match(page, /__BID_COPILOT_ADAPTER_REVISION__/);
});

test("browser mode avoids background data polling", () => {
  const page = read("panel/app/page.tsx");
  assert.match(page, /DATA_REFRESH_INTERVAL = 45_000/);
  assert.match(page, /mode === "browser"/);
  assert.match(page, /visibilitychange/);
  assert.doesNotMatch(page, /setInterval\(refreshData, 12000\)/);
});

test("Windows launcher defaults to a cached production build", () => {
  const launcher = read("Start-BidCopilot.ps1");
  assert.match(launcher, /\[switch\]\$DevMode/);
  assert.match(launcher, /\.next\\BUILD_ID/);
  assert.match(launcher, /npm\.cmd run build/);
  assert.match(launcher, /@\("run", "start"/);
  assert.match(launcher, /-not \(Test-Path \(Join-Path \$PanelPath "node_modules"\)\)/);
});

test("local fallback uses memory caching, serialized writes, and atomic rename", () => {
  const store = read("panel/lib/store.ts");
  assert.match(store, /bidCopilotLocalCache/);
  assert.match(store, /bidCopilotLocalWrites/);
  assert.match(store, /mutateJson/);
  assert.match(store, /fs\.rename\(temporary, file\)/);
  assert.match(store, /process\.env\.COPILOT_DATA_DIR/);
});

test("project inspection reads the heavyweight body text only once", () => {
  const adapters = read("extension/adapters.js");
  const inspectBlock = adapters.slice(adapters.indexOf("async inspect()"), adapters.indexOf("openProposalForm()"));
  assert.equal((inspectBlock.match(/document\.body\?\.innerText/g) || []).length, 1);
  assert.match(inspectBlock, /competitionSnapshot\(bodyText\)/);
  assert.match(inspectBlock, /findBudget\(a, bodyText, contextual\)/);
});

test("Electron navigation has one owner and ignores expected aborts", () => {
  const page = read("panel/app/page.tsx");
  assert.doesNotMatch(page, /allowpopups/);
  assert.doesNotMatch(page, /setBrowserUrl/);
  assert.match(page, /ERR_ABORTED\|\\\(-3\\\)/);
  assert.match(page, /async function navigateBrowser/);
  assert.match(page, /browserCard browserHidden/);
});

test("Electron exposes independent browser recovery and workspace refresh", () => {
  const main = read("desktop/main.cjs");
  const preload = read("desktop/preload.cjs");
  assert.match(main, /copilot:recover-marketplace/);
  assert.match(main, /copilot:reload-workspace/);
  assert.match(main, /copilot:reload-marketplace/);
  assert.match(main, /copilot:stop-marketplace/);
  assert.match(main, /accelerator: "CmdOrCtrl\+R"/);
  assert.match(main, /accelerator: "CmdOrCtrl\+Shift\+R"/);
  assert.match(main, /accelerator: "F5"/);
  assert.match(main, /accelerator: "Esc"/);
  assert.match(main, /accelerator: "CmdOrCtrl\+L"/);
  assert.match(preload, /recoverMarketplace/);
  assert.match(preload, /reloadMarketplace/);
  assert.match(preload, /stopMarketplace/);
  assert.match(preload, /onFocusAddress/);
  assert.match(preload, /reloadWorkspace/);
});

test("panel, desktop, and extension versions stay aligned", () => {
  const panel = JSON.parse(read("panel/package.json"));
  const desktop = JSON.parse(read("desktop/package.json"));
  const extension = JSON.parse(read("extension/manifest.json"));
  const worker = JSON.parse(read("worker/package.json"));
  assert.equal(panel.version, desktop.version);
  assert.equal(panel.version, extension.version);
  assert.equal(panel.version, worker.version);
  assert.match(read("extension/popup.js"), new RegExp(`ENGINE_VERSION = "${panel.version.replaceAll(".", "\\.")}"`));
  assert.match(read("extension/service-worker.js"), new RegExp(`ENGINE_VERSION = "${panel.version.replaceAll(".", "\\.")}"`));
  assert.match(read("extension/options.html"), new RegExp(`v${panel.version.replaceAll(".", "\\.")}`));
  assert.match(read("panel/app/page.tsx"), new RegExp(`v${panel.version.replaceAll(".", "\\.")}`));
  assert.match(read("worker/src/index.mjs"), new RegExp(`VERSION = "${panel.version.replaceAll(".", "\\.")}"`));
});
