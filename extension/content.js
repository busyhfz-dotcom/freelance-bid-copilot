(() => {
  if (globalThis.__BID_COPILOT_CONTENT_READY__) return;
  globalThis.__BID_COPILOT_CONTENT_READY__ = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message.type === "PING") {
          sendResponse({ ok: true, ready: true });
          return;
        }
        if (!window.BidCopilotAdapter) throw new Error("Adapter not loaded");
        if (message.type === "INSPECT") sendResponse({ ok: true, project: await window.BidCopilotAdapter.inspect() });
        else if (message.type === "SCAN_LIST") sendResponse(window.BidCopilotAdapter.scanList());
        else if (message.type === "OPEN_FORM") sendResponse(window.BidCopilotAdapter.openProposalForm());
        else if (message.type === "FILL") sendResponse(window.BidCopilotAdapter.fill(message.payload));
        else if (message.type === "SUBMIT") sendResponse(window.BidCopilotAdapter.submit());
        else sendResponse({ ok: false, reason: "Unknown message" });
      } catch (error) {
        sendResponse({ ok: false, reason: error?.message || String(error) });
      }
    })();
    return true;
  });
})();
