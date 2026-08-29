import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { chromium } from "playwright";

const site = String(process.argv[2] || "").toLowerCase();
const urls = {
  kaya: process.env.KAYA_LOGIN_URL || "https://kaya.ir/",
  ponisha: process.env.PONISHA_LOGIN_URL || "https://ponisha.ir/"
};
if (!urls[site]) throw new Error("Usage: npm run capture-auth -- kaya|ponisha");

const output = path.resolve(process.env.AUTH_OUTPUT_DIR || "secrets", `${site}.storage-state.json`);
await fs.mkdir(path.dirname(output), { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: "fa-IR", timezoneId: "Asia/Tehran" });
const page = await context.newPage();
await page.goto(urls[site], { waitUntil: "domcontentloaded" });
const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
await prompt.question(`Sign in to ${site} in the opened browser. Complete any CAPTCHA yourself, then press Enter here to save the session. `);
await context.storageState({ path: output });
await fs.chmod(output, 0o600).catch(() => undefined);
await browser.close();
prompt.close();
console.log(`Sensitive auth state saved to: ${output}`);
console.log("Do not commit or share this file. Place it only in the Worker's protected persistent volume.");
