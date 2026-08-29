# Bid Copilot Desktop

The desktop shell loads the hosted panel and embeds authenticated Kaya/Ponisha pages in the same window. Marketplace cookies stay inside Electron's persistent `persist:bid-copilot` session and are never sent to the panel API.

```powershell
cd .\desktop
npm.cmd install
$env:PANEL_URL = "https://panel.example.com"
npm.cmd start
```

For local panel development, omit `PANEL_URL`; the shell defaults to `http://localhost:3000`.

Build the Windows installer only after the full test suite and panel production build pass:

```powershell
npm.cmd run dist:win
```
