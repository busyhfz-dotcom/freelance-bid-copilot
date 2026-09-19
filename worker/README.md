# Always-on Browser Worker

This service keeps authenticated Kaya and Ponisha browser sessions online, scans new projects, asks the hosted panel to rank/generate bids, and queues only guarded `BID` decisions for Telegram approval. It calls the marketplace submit control only after an atomic, unexpired Telegram approval claim and a fresh page revalidation.

## Authentication bootstrap

Run locally from `worker/`:

```bash
npm install
npm run capture-auth -- kaya
npm run capture-auth -- ponisha
```

The files under `worker/secrets/` are equivalent to logged-in browser credentials. Never commit, email, or put them in a public object store. Transfer them only to `/data/auth/` on the private persistent volume, or Base64-encode them and add the values as encrypted one-time deployment secrets (`KAYA_STORAGE_STATE_B64` and `PONISHA_STORAGE_STATE_B64`). Remove the Base64 secrets after the files have been written to the volume.

## Railway

1. Deploy this repository with `worker/Dockerfile`.
2. Mount a persistent volume at `/data`.
3. Copy all values from `.env.example` into Railway Variables and use the same `WORKER_KEY` in Vercel.
4. Keep at least one always-running replica. The health check is `/health`.
5. Set the marketplace list URLs to the exact logged-in project listing pages if the defaults redirect.

The Worker never bypasses CAPTCHA or login challenges. It pauses, reports `blocked`, and sends a Telegram alert through the panel. Failed/uncertain submissions are not retried automatically.
Blocked marketplaces are retried independently after `BLOCKED_SITE_RETRY_MINUTES` (15 by default), so one challenged site does not stop scanning the others. The panel persists alert fingerprints and suppresses identical Telegram warnings for `WORKER_ALERT_COOLDOWN_MINUTES` (30 by default), then sends one recovery message when the site is ready again.


## Scan liveness and controlled recovery

The independent 15-second watchdog checks monotonic elapsed time. With default
settings it recycles the Worker after 15 minutes without a successfully completed
marketplace scan, or without a completed cycle (including a stopped scheduler or
hung startup). A hung active cycle still uses the existing, earlier full-cycle
watchdog. A valid empty listing is success; errors, malformed listings, skipped
blocked sites and login/CAPTCHA responses are not. One healthy marketplace keeps
scanning alive while the other site's session status remains visible.

DEAD_MAN_TIMEOUT_SECONDS defaults to 900 (180–7200). The effective dead-man
threshold is at least the polling interval plus the full-cycle watchdog budget,
so deliberately slow polling does not create restart loops. It is visible in
/health under deadMan.timeoutMs. /health returns 503 when stale or recovering,
and exposes lastSuccessfulScanAt, cycle completion and age, active cycle age,
reason, configured/effective thresholds, and the last restart time/reason.
Historical success does not bypass a new process's startup grace period.

OOM, scheduled recycle, scan watchdog and dead-man recovery share a single exit
gate. Recovery immediately stops scheduling and arms a referenced 30-second exit
deadline before any I/O. It checkpoints the outbox, seen keys, inspection quarantine
and recovery diagnostics on /data, then attempts to save browser auth, report to
the panel and close Chromium. Exit 1 invokes Railway's ALWAYS restart policy.
SIGTERM/SIGINT use the same bounded checkpoint path with exit 0. An unavailable
browser preserves the last valid auth snapshot. All state writes are serialized
per file, use private temporary files, fsync and atomic rename. Inspected projects
enter the durable outbox immediately, including before later inspections time out.
Ambiguous in-flight deliveries remain retryable using existing panel deduplication.
Corrupt state fails startup rather than being overwritten with empty data.

Recovery diagnostics are always logged and saved to state/worker-recovery.json.
Remote recycle reports are limited to one attempt per 30 minutes across restarts.
No watchdog sends Telegram messages: Telegram remains exclusive to project alerts.
Network reporting and browser cleanup cannot indefinitely postpone exit. If disk
I/O fails, the last committed files are retained and errors are logged; no process
can guarantee a new checkpoint on an unavailable volume. Timers require a responsive
Node event loop; a process/host freeze or SIGKILL requires platform supervision.

Verification: run node --test tests/*.test.mjs from the repository root. Tests use
fake elapsed time, injected browser/network failures and real temporary state files;
no production credentials, Telegram calls or intentional production outage are needed.
After deploying, confirm Railway SUCCESS, the Worker started log with deadMan settings,
and scan cycle completed logs with a nonempty lastSuccessfulScanAt.
