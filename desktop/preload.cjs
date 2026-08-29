const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bidCopilotDesktop", Object.freeze({
  isDesktop: true,
  getSettings: () => ipcRenderer.invoke("copilot:get-settings"),
  setPanelUrl: (panelUrl) => ipcRenderer.invoke("copilot:set-panel-url", panelUrl),
  getAdapterScripts: () => ipcRenderer.invoke("copilot:get-adapter-scripts"),
  recoverMarketplace: () => ipcRenderer.invoke("copilot:recover-marketplace"),
  reloadMarketplace: () => ipcRenderer.invoke("copilot:reload-marketplace"),
  stopMarketplace: () => ipcRenderer.invoke("copilot:stop-marketplace"),
  onFocusAddress: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("copilot:focus-address", listener);
    return () => ipcRenderer.removeListener("copilot:focus-address", listener);
  },
  reloadWorkspace: () => ipcRenderer.invoke("copilot:reload-workspace")
}));
