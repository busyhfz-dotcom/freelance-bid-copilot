# Freelance Bid Copilot v0.5.1

## v0.5.1 — Private Supabase control plane

- Moves all Bid Copilot data into the isolated `bid_copilot` PostgreSQL schema.
- Enables RLS on all four control-plane tables and revokes schema/table access from `anon` and `authenticated`.
- Adds an idempotent deployment SQL file and verifies the live Supabase schema independently.
- Keeps the Vercel server connected through a small transaction-pool-friendly PostgreSQL pool.

Validation: 58/58 tests, TypeScript and the production Next.js build pass.

---

## v0.5.0 — Always-on Telegram approval automation

- Adds a Dockerized Playwright Browser Worker that stays online independently of the user's computer and scans authenticated Kaya and Ponisha project listings.
- Ranks new projects continuously and queues a bounded 5–10 best guarded `BID` candidates per cycle when enough suitable projects exist.
- Sends each short, project-specific proposal, price and delivery estimate to one authorized Telegram account with Approve/Reject buttons.
- Uses short-lived one-time approval tokens and PostgreSQL `FOR UPDATE SKIP LOCKED` claims to prevent unauthorized, stale or duplicate submission.
- Re-inspects the live project after approval and revalidates BID/Guard, budget and locked proposal fields before calling final Submit.
- Stops on login challenges, CAPTCHA, changed budgets or uncertain submit outcomes; it alerts Telegram and never bypasses or automatically retries an uncertain submission.
- Adds an Automation dashboard for Worker heartbeat, per-market session state, approval status and submission result.
- Tightens proposal style: 2–4 short paragraphs, direct project opening, result-first wording and no repetitive AI-template headings.
- Adds Vercel + Supabase + Railway deployment instructions with protected persistent browser state.

Validation: all 57 tests, production build, TypeScript, Electron/extension/Worker syntax, API authorization and local queue/heartbeat smoke tests pass before stamping this release.

Deployment guide: `DEPLOYMENT-VERCEL-SUPABASE.md`.

---

## v0.4.0 — Fast production workspace

- Runs the local panel in optimized Production mode by default; the launcher rebuilds only when source files changed and skips repeated dependency installs.
- Caches the Electron adapter bundle in memory, injects it once per page document and waits for the real DOM instead of showing an early four-second Reload warning.
- Reads the heavyweight marketplace body text once per Inspect and caches list-card text/layout checks during extraction.
- Stops browser-mode background polling; history and project data refresh every 45 seconds only while those views are visible.
- Adds memory-cached local history, serialized updates and atomic JSON writes while retaining PostgreSQL on hosted deployments.
- Adds separate Stop, fast Refresh and full Recover controls plus `Esc`, `F5` and `Ctrl+L` shortcuts.
- Adds a collapsible Live Intelligence pane, live operation status and a one-click `Inspect + Bid` workflow. Final Fill and Submit safeguards are unchanged.
- Adds five performance/workflow regressions; the complete suite now contains 47 tests.

Validation: all 47 tests, production build, TypeScript, Electron/extension syntax, API authorization, local persistence and end-to-end search create/list checks pass before stamping this release.

---

## v0.3.2 — Electron navigation and recovery

- Removes the invalid boolean `allowpopups` attribute that triggered the Next.js development error overlay.
- Gives navigation a single owner instead of changing WebView `src` and calling `loadURL()` simultaneously.
- Treats Electron `ERR_ABORTED (-3)` as an expected superseded navigation, while retaining real load failures.
- Keeps the authenticated WebView mounted when switching to Search History or Project Ledger, preserving page state and session.
- Adds a browser recovery control that stops pending loading and refreshes the marketplace guest process without restarting the panel.
- Adds full Workspace refresh from the UI plus native Electron shortcuts: `Ctrl+R`, `Ctrl+Shift+R`, and `F5` for marketplace recovery.
- Adds two Electron regressions; the complete suite now contains 42 tests.

Validation: all 42 tests, production build, TypeScript, Electron syntax and version parity checks pass before stamping this patch.

---

## v0.3.1 — Inspect performance fix

- Removes the broad all-`div` layout scan that could stall Electron on long Ponisha project pages.
- Uses bounded, targeted proposal-card selectors while retaining text-signal fallback for generic card markup.
- Stops climbing the DOM as soon as a useful competition section is found.
- Adds separate 4-second adapter and 8-second page-inspection timeouts so the UI cannot remain on «در حال خواندن» indefinitely.
- Adds two performance regressions; the complete suite now contains 40 tests.

Validation: all 40 tests, production build, TypeScript and adapter syntax checks pass before stamping this patch.

---

## v0.3.0 — One-window Workspace

- Rebuilds the panel as a dense, dark desktop workspace with a browser surface, Live Intelligence, search archive and project ledger.
- Adds an Electron Windows client that displays the real logged-in Kaya and Ponisha pages inside the same application window with a persistent local session.
- Keeps Node.js disabled inside marketplace pages, isolates the hosted panel with `contextIsolation` and restricts embedded navigation to Kaya/Ponisha hosts.
- Runs marketplace list search from the panel, extracts results through the existing DOM adapters, and saves each search plus its result list.
- Stores projects and searches centrally in PostgreSQL when `DATABASE_URL` is configured; local development falls back to `panel/.data/*.json`.
- Protects hosted project/search reads and writes with `COPILOT_KEY`; passwords and marketplace cookies never enter the hosted API.
- Preserves Match Engine, Logo/Branding vs Web/UI regressions, Hard Domain Gate and guarded Fill. The workspace does not call the final submit action.
- Adds 7 workspace/security regressions; the complete suite now contains 38 tests.

Validation: all 38 tests, the production Next.js build, TypeScript checks, Electron/extension JavaScript syntax checks, API authorization smoke tests and browser interaction/visual checks pass before this version is stamped.

### Architecture

`Hosted Next.js panel + PostgreSQL` stores the shared history. `Electron + persistent WebView` keeps the authenticated marketplace session on the user's computer and loads the hosted panel in the same window.

### Run locally with PowerShell

```powershell
Set-Location "C:\path\to\freelance-bid-copilot"
powershell.exe -ExecutionPolicy Bypass -File .\Start-BidCopilot.ps1
```

### Connect the desktop app to the hosted panel

```powershell
Set-Location "C:\path\to\freelance-bid-copilot"
powershell.exe -ExecutionPolicy Bypass -File .\Start-BidCopilot.ps1 -PanelUrl "https://panel.example.com"
```

On the server set `COPILOT_KEY`, `DATABASE_URL`, `DATABASE_SSL=require`, and optionally the OpenAI variables shown in `panel/.env.example`. The database tables are created automatically on the first API request.

---

## v0.2.2 — Kaya adapter hardening

- Detects Kaya's English-labelled `Amount (USD)` and `Delivery Time (Days)` fields from their associated labels, not only input names/placeholders.
- Adds conservative multi-currency budget parsing for labelled fixed budgets and explicit ranges while refusing to treat the proposal Amount placeholder as employer budget.
- Recognizes compact Kaya competition labels such as `Bids: 12` and still ignores remaining-bid quotas.
- Separates an unavailable budget from a verified out-of-budget price: unavailable budget produces `MAYBE` for manual review, while confirmed out-of-range pricing remains `SKIP`.
- Keeps Auto-submit blocked whenever budget or competition is unverified.
- Reports the actual SKIP reason when Fill is blocked instead of incorrectly claiming every guard failure is an out-of-profile project.
- Adds 12 Kaya-specific regression tests; the complete suite now contains 31 tests.

Validation: all 31 tests, the production Next.js build, TypeScript checks, extension JavaScript syntax checks and JSON/version parity checks pass before this version is stamped.

---

## v0.2.1 — Match Engine regression hardening

- Distinguishes a requested Logo/Branding deliverable from an existing logo or brand identity used only as context for Web/UI work.
- Keeps new/custom logo requests classified as Logo/Branding even when the same title mentions a website, landing page or UI.
- Normalizes slash-separated profile terms and Persian zero-width spacing without inflating duplicate domain evidence.
- Fails closed on malformed domain arrays and keeps the panel and extension matchers behaviorally aligned.
- Adds 19 regression tests for Logo/Branding vs Web/UI, Hard Domain Gate caps, explicit overrides, related-domain limits, missing/malformed profiles and panel/extension parity.

Validation: all 19 tests, the production Next.js build, TypeScript checks, extension JavaScript syntax checks and JSON manifest/package checks pass before this version is stamped.

---

## v0.2.0 — Hard Domain Gate

This release replaces loose keyword similarity with a conservative domain gate. The project deliverable is classified first (for example Web/UI, WordPress, Logo/Branding, Graphic, Development, Content, Marketing, Video, Architecture or Data). Only domains explicitly selected in Settings — or conservatively inferred from the freelancer profile when no explicit selection exists — can become OPEN/BID.

Key safeguards:
- Generic words such as «طراحی», design, site, web, project and similar context words cannot create a high Match by themselves.
- Specific deliverables take precedence over context: “logo for a website” is Logo/Branding, not Web/UI.
- OUT OF PROFILE domains are hard-capped at 35% Match and SKIP in Scout.
- RELATED domains are capped at 60% and can only REVIEW/MAYBE; they cannot Auto-submit.
- UNKNOWN domains cannot become BID automatically.
- Auto-submit requires domainGate=allowed in addition to the existing Match, Job, budget, competition, quality, duplicate and form-lock guards.
- Settings now include explicit Hard Domain Gate checkboxes.

Validation included in this build covers logo-vs-web context, WordPress, UI/UX, graphic design, development adjacency, explicit domain override, and parity between the extension matcher and panel matcher.

---

# Freelance Bid Copilot v0.1.9

## v0.1.9 changes
- Domain-aware Match for both Quick Scout and full project analysis. Generic words such as `design / طراحی / project` no longer create a strong match by themselves.
- Separates Web/UI-UX, WordPress/CMS, Logo/Branding, Graphic Design, Software Development, Content, Marketing, Video, Architecture and Data domains.
- Strongly penalizes domain mismatch: e.g. a Logo/Branding project no longer ranks as a high Web/UI match just because both contain the word `طراحی`.
- Adds **Skill Gap** labels to Scout cards and detailed analysis.
- Keeps v0.1.8 Scout thresholds, Next Best workflow, competition-aware pricing, duplicate guard and locked Proposal/Price/Days filling.

## v0.1.8 changes
- Stricter Quick Scout: Match below 65% cannot be OPEN; below 55% is SKIP.
- Match has a higher weight and title/skill matches are trusted more than long snippets.
- Competition-aware pricing: medium/high competition shifts the bid lower within the employer range, especially on very wide budgets.
- Next Best Project reuses the current tab and skips projects already analyzed or filled.
- List pages stay in Scout mode; the false project-detail SKIP panel is hidden.
- Quick Bid Queue collapses on project detail pages to keep the popup compact.

# Freelance Bid Copilot v0.1.7

Local Next.js panel + Chrome/Edge extension for faster, reviewable bidding on freelance marketplaces.


## v0.1.7 — Project Scanner + Quick Bid Queue

- Adds **Scan project list** for Ponisha/Kaya list pages using DOM-only extraction from the logged-in browser tab.
- Extracts project title, URL, visible budget, age/freshness text, short card context and visible skill/tag hints without sending passwords or cookies to the panel.
- Adds a fast local **Scout Score** based on freelancer-profile match, freshness, brief quality and budget availability. This is a pre-screening score; the full Job/Match/Competition/Bid decision still runs after opening the project.
- Builds a ranked **Quick Bid Queue** inside the extension, remembers the latest scan, marks projects already filled/submitted as DONE, and can open the best candidate directly.
- Does **not** submit from a list page. The selected project must still pass the full project-page `BID / MAYBE / SKIP` analysis and guarded Fill/Submit flow.

## v0.1.6 — Ponisha competition detector hardened

- Finds the actual short proposal-list heading instead of accidentally selecting a large parent container.
- Counts rendered proposal cards using both minimal card nodes and Ponisha's repeated `زمان تحویل` + `ارسال پیشنهاد در` signals.
- Marks signal-based counts as approximate section counts and keeps the conservative competition-score cap.
- Keeps BID/MAYBE/SKIP, locked Price/Days/Proposal filling and guarded Auto-submit from v0.1.5.

## v0.1.5 — competition, decision engine, locked form fields

- Detects proposal competition from explicit marketplace text when available.
- Falls back to counting visible freelancer/proposal cards and marks that count as an approximate visible-card signal.
- Competition now has a stronger effect on Job Score.
- Adds a clear `BID / MAYBE / SKIP` decision with a short reason before filling the form.
- Safe Auto-submit only permits `BID`; it blocks when competition is unknown.
- Proposal form filling is locked to the proposal scope. Price and delivery fields are selected by local labels/context and payment-secure / percentage / milestone inputs are explicitly rejected.
- The final submit button is only detected inside the proposal form scope; there is no global submit fallback.
- Duplicate-project, budget, Match, Job Score and Bid Quality guards from v0.1.4 remain enabled.

## Run the panel

```bash
cd panel
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Optional AI generation requires `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env.local`. Without them, the local fallback generator is used.

## Install / update the extension

1. Extract the ZIP.
2. Open `chrome://extensions` or `edge://extensions`.
3. Remove the old unpacked extension, or use **Load unpacked** with the new `extension/` folder.
4. Keep your real freelancer skills in Extension Settings so Match Score can be calculated.
5. Keep Auto-submit off until the marketplace adapter has been tested on several real projects.

## Default flow

`Project list → Scan → Quick Bid Queue → Open candidate → Analyze & Generate → BID/MAYBE/SKIP → Approve → Fill → optional guarded submit`

The extension operates inside the already logged-in marketplace page. Browser passwords/cookies are not sent to the local panel.
