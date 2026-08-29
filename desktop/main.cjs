const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_PANEL_URL = "http://localhost:3000";
const SESSION_PARTITION = "persist:bid-copilot";
const MARKETPLACE_HOSTS = ["kaya.ir", "ponisha.ir"];

let mainWindow = null;
let marketplaceGuest = null;
let panelOrigin = new URL(DEFAULT_PANEL_URL).origin;
let adapterBundlePromise = null;

function isMarketplaceUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && MARKETPLACE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function normalizePanelUrl(rawUrl) {
  const url = new URL(rawUrl || DEFAULT_PANEL_URL);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Panel URL must use HTTPS (HTTP is allowed only on localhost).");
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

async function readSettings() {
  let stored = {};
  try { stored = JSON.parse(await fs.readFile(configPath(), "utf8")); } catch {}
  const panelUrl = normalizePanelUrl(process.env.PANEL_URL || stored.panelUrl || DEFAULT_PANEL_URL);
  return { panelUrl, version: app.getVersion(), platform: process.platform };
}

async function writePanelUrl(panelUrl) {
  const normalized = normalizePanelUrl(panelUrl);
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify({ panelUrl: normalized }, null, 2), "utf8");
  return { panelUrl: normalized, version: app.getVersion(), platform: process.platform };
}

function adapterDirectory() {
  return app.isPackaged ? path.join(process.resourcesPath, "extension") : path.join(__dirname, "..", "extension");
}

async function adapterScripts() {
  if (!adapterBundlePromise) {
    adapterBundlePromise = (async () => {
      const directory = adapterDirectory();
      const [core, adapters] = await Promise.all([
        fs.readFile(path.join(directory, "adapter-core.js"), "utf8"),
        fs.readFile(path.join(directory, "adapters.js"), "utf8")
      ]);
      return {
        revision: app.getVersion(),
        bundle: `${core}\n${adapters}`
      };
    })().catch((error) => {
      adapterBundlePromise = null;
      throw error;
    });
  }
  return adapterBundlePromise;
}

function secureWebview(guest) {
  marketplaceGuest = guest;
  guest.setWindowOpenHandler(({ url }) => {
    if (isMarketplaceUrl(url)) guest.loadURL(url);
    return { action: "deny" };
  });
  guest.on("will-navigate", (event, url) => {
    if (!isMarketplaceUrl(url)) event.preventDefault();
  });
  guest.once("destroyed", () => {
    if (marketplaceGuest === guest) marketplaceGuest = null;
  });
}

function reloadWorkspace(ignoreCache = true) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (ignoreCache) mainWindow.webContents.reloadIgnoringCache();
  else mainWindow.webContents.reload();
  return true;
}

function recoverMarketplace() {
  if (!marketplaceGuest || marketplaceGuest.isDestroyed()) return false;
  marketplaceGuest.stop();
  marketplaceGuest.reloadIgnoringCache();
  return true;
}

function reloadMarketplace() {
  if (!marketplaceGuest || marketplaceGuest.isDestroyed()) return false;
  marketplaceGuest.reload();
  return true;
}

function stopMarketplace() {
  if (!marketplaceGuest || marketplaceGuest.isDestroyed()) return false;
  marketplaceGuest.stop();
  return true;
}

function focusPanelAddressBar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("copilot:focus-address");
}

function installApplicationMenu() {
  const menu = Menu.buildFromTemplate([{
    label: "Workspace",
    submenu: [
      { label: "Refresh Workspace", accelerator: "CmdOrCtrl+R", click: () => reloadWorkspace(false) },
      { label: "Force Refresh Workspace", accelerator: "CmdOrCtrl+Shift+R", click: () => reloadWorkspace(true) },
      { label: "Recover Marketplace Browser", accelerator: "F5", click: () => recoverMarketplace() },
      { label: "Stop Marketplace Loading", accelerator: "Esc", click: () => stopMarketplace() },
      { label: "Focus Address Bar", accelerator: "CmdOrCtrl+L", click: () => focusPanelAddressBar() },
      { type: "separator" },
      { role: "toggleDevTools" }
    ]
  }]);
  Menu.setApplicationMenu(menu);
}

async function createWindow() {
  const settings = await readSettings();
  panelOrigin = new URL(settings.panelUrl).origin;
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#090a0d",
    title: "Bid Copilot Workspace",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false
    }
  });

  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    params.partition = SESSION_PARTITION;
    if (!isMarketplaceUrl(params.src)) params.src = "https://kaya.ir/";
  });
  mainWindow.webContents.on("did-attach-webview", (_event, guest) => secureWebview(guest));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== panelOrigin) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  await mainWindow.loadURL(settings.panelUrl);
}

ipcMain.handle("copilot:get-settings", () => readSettings());
ipcMain.handle("copilot:set-panel-url", async (_event, panelUrl) => {
  const settings = await writePanelUrl(String(panelUrl || ""));
  panelOrigin = new URL(settings.panelUrl).origin;
  if (mainWindow) await mainWindow.loadURL(settings.panelUrl);
  return settings;
});
ipcMain.handle("copilot:get-adapter-scripts", () => adapterScripts());
ipcMain.handle("copilot:recover-marketplace", () => recoverMarketplace());
ipcMain.handle("copilot:reload-marketplace", () => reloadMarketplace());
ipcMain.handle("copilot:stop-marketplace", () => stopMarketplace());
ipcMain.handle("copilot:reload-workspace", () => {
  setTimeout(() => reloadWorkspace(true), 50);
  return true;
});

app.whenReady().then(() => {
  installApplicationMenu();
  return createWindow();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
