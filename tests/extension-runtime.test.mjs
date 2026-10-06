import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";

const read = (name) => fs.readFileSync(path.resolve(import.meta.dirname, `../extension/${name}`), "utf8");
const require = createRequire(import.meta.url);
const guard = require("../extension/guard-policy.js");

test("content-script handshake reports the installed extension version after reinjection", async () => {
  const version = JSON.parse(read("manifest.json")).version;
  const listeners = new Set();
  const context = vm.createContext({
    chrome: { runtime: { onMessage: {
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); }
    } } },
    window: {}
  });
  const script = read("content.js");
  vm.runInContext(script, context);
  vm.runInContext(script, context);
  assert.equal(listeners.size, 1, "reinjection must replace the old listener");
  const ping = await new Promise((resolve) => [...listeners][0]({ type: "PING" }, {}, resolve));
  assert.equal(ping.ok, true);
  assert.equal(ping.version, version);
});

test("popup clears a stored proposal when it contains model reasoning", () => {
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        dataset: {}, textContent: "", className: "",
        classList: {
          add(name) { classes.add(name); },
          remove(name) { classes.delete(name); },
          toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
          contains(name) { return classes.has(name); }
        }
      });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    CopilotGuard: guard,
    updatePageMode() {}
  });
  vm.runInContext(read("popup.js").split("function queueDecisionClass")[0], context);
  element("preview").dataset.ready = "1";
  element("bidPreview").textContent = "old project proposal";
  const shown = vm.runInContext("showGenerated({ bid: \"Here's a thinking process:\\n1. Analyze the request\" })", context);
  assert.equal(shown, false);
  assert.equal(element("preview").dataset.ready, "");
  assert.equal(element("bidPreview").textContent, "");
  assert.equal(element("preview").classList.contains("hidden"), true);
});
