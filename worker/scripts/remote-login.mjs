import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const dataDir = path.resolve(process.env.BROWSER_DATA_DIR || "/data");
const statePath = process.env.PONISHA_STORAGE_STATE_PATH
  || path.join(dataDir, "auth/ponisha.storage-state.json");
const loginUrl = process.env.PONISHA_LOGIN_URL || "https://ponisha.ir/";

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function saveState(context) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await context.storageState({ path: temporary });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, statePath);
}

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-dev-shm-usage"]
});
const context = await browser.newContext({
  locale: "fa-IR",
  timezoneId: "Asia/Tehran",
  viewport: { width: 1400, height: 820 },
  storageState: await exists(statePath) ? statePath : undefined
});
const page = await context.newPage();
await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);

let saving = false;
const timer = setInterval(async () => {
  if (saving) return;
  saving = true;
  try {
    await saveState(context);
  } catch (error) {
    console.error("remote login state save failed:", error.message);
  } finally {
    saving = false;
  }
}, 5_000);

async function shutdown() {
  clearInterval(timer);
  await saveState(context).catch(() => undefined);
  await browser.close().catch(() => undefined);
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
console.log("Temporary Ponisha login browser started; session state is stored owner-only");
await new Promise(() => {});
