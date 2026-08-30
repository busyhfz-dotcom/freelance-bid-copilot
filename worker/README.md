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
