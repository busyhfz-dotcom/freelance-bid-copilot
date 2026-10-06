(() => {
  const CONTENT_VERSION = "0.7.6";
  const previous = globalThis.__BID_COPILOT_CONTENT_STATE__;
  if (previous?.listener) chrome.runtime.onMessage.removeListener(previous.listener);

  const listener = (message, _sender, sendResponse) => {
    (async () => {
      try {
        if (message.type === "PING") {
          sendResponse({ ok: true, ready: true, version: CONTENT_VERSION });
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
  };
  chrome.runtime.onMessage.addListener(listener);
  globalThis.__BID_COPILOT_CONTENT_STATE__ = { version: CONTENT_VERSION, listener };
})();
