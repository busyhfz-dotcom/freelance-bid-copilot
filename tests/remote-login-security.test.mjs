import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("temporary remote login is opt-in, password protected, and time bounded", () => {
  const entrypoint = read("worker/docker-entrypoint.sh");
  const remote = read("worker/remote-login-entrypoint.sh");
  assert.match(entrypoint, /PONISHA_REMOTE_LOGIN_ENABLED/);
  assert.match(remote, /PONISHA_REMOTE_LOGIN_PASSWORD/);
  assert.match(remote, /\?\?\?\?\?\?\?\?/);
  assert.match(remote, /PONISHA_REMOTE_LOGIN_TTL_MINUTES/);
  assert.match(remote, /-rfbauth/);
  assert.match(remote, /-localhost/);
  assert.match(remote, /websockify --web=\/usr\/share\/novnc/);
  assert.match(remote, /rm -f "\$vnc_password"/);
});

test("remote login persists only an owner-readable Playwright storage state", () => {
  const login = read("worker/scripts/remote-login.mjs");
  assert.match(login, /context\.storageState/);
  assert.match(login, /fs\.chmod\(temporary, 0o600\)/);
  assert.match(login, /fs\.rename\(temporary, statePath\)/);
  assert.match(login, /headless: false/);
  assert.doesNotMatch(login, /captcha.*(?:solve|bypass)/i);
});

test("remote desktop packages and port are isolated from the Worker health port", () => {
  const docker = read("worker/Dockerfile");
  assert.match(docker, /novnc websockify x11vnc xvfb/);
  assert.match(docker, /EXPOSE 8080 6080/);
  assert.match(docker, /bid-copilot-remote-login/);
});
