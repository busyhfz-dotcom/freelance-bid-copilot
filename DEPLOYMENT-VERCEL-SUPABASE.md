# استقرار دائمی Bid Copilot

این نسخه سه سرویس مستقل دارد:

1. **Vercel / `panel`**: داشبورد، API، webhook تلگرام و تولید بید.
2. **Supabase Postgres**: پروژه‌ها، صف تأیید، نتیجه ثبت و heartbeat Worker.
3. **Railway / `worker`**: مرورگر Playwright دائمی با نشست ورود کایا و پونیشا.

Vercel و Supabase به‌تنهایی مرورگر لاگین‌شدهٔ دائمی اجرا نمی‌کنند؛ Worker باید روی یک سرویس Container همیشه‌روشن با Volume پایدار باشد.

## 1. Supabase

در Supabase یک پروژه بساز و Connection string مربوط به **Transaction pooler** را دریافت کن. جداول در اولین درخواست سرور به‌صورت خودکار ساخته می‌شوند. این دو مقدار را برای Vercel نگه دار:

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=require
```

## 2. Telegram Bot

با BotFather یک Bot بساز، یک پیام برای Bot بفرست و شناسهٔ عددی حساب/چت خودت را پیدا کن. سپس چهار Secret زیر را آماده کن:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_ALLOWED_USER_ID=...
TELEGRAM_WEBHOOK_SECRET=<random-secret>
```

`TELEGRAM_ALLOWED_USER_ID` باید شناسهٔ عددی همان حسابی باشد که اجازهٔ تأیید و رد دارد.

## 3. Vercel

پروژه را با Root Directory برابر `panel` Deploy کن. Variables زیر را برای Production تنظیم کن:

```text
COPILOT_KEY=<random-secret>
WORKER_KEY=<different-random-secret-at-least-24-characters>
DATABASE_URL=<supabase-transaction-pooler-url>
DATABASE_SSL=require
COPILOT_PROTECT_READS=true
OPENAI_API_KEY=...
OPENAI_MODEL=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_ALLOWED_USER_ID=...
TELEGRAM_WEBHOOK_SECRET=...
AUTOMATION_MIN_SCORE=72
AUTOMATION_MAX_PENDING=10
APPROVAL_TTL_MINUTES=30
```

پس از Deploy، webhook را در PowerShell ثبت کن. مقادیر Secret را فقط در همان ترمینال خودت وارد کن:

```powershell
$BotToken = Read-Host "Telegram bot token"
$WebhookSecret = Read-Host "Telegram webhook secret"
$PanelUrl = "https://YOUR-PANEL.vercel.app"

$WebhookBody = @{
  url = "$PanelUrl/api/telegram/webhook"
  secret_token = $WebhookSecret
  allowed_updates = '["callback_query"]'
}

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$BotToken/setWebhook" `
  -Body $WebhookBody
```

## 4. ساخت نشست ورود روی کامپیوتر خودت

از پوشه `worker` اجرا کن:

```powershell
npm.cmd install
npm.cmd run capture-auth -- kaya
npm.cmd run capture-auth -- ponisha
```

مرورگر باز می‌شود. خودت وارد حساب شو و اگر CAPTCHA وجود داشت آن را دستی حل کن، سپس در PowerShell Enter بزن. فایل‌های زیر ساخته می‌شوند:

```text
worker/secrets/kaya.storage-state.json
worker/secrets/ponisha.storage-state.json
```

این فایل‌ها معادل دسترسی به حساب‌های لاگین‌شده‌اند؛ آن‌ها را در Git، ZIP عمومی، ایمیل یا فضای عمومی قرار نده.

## 5. Railway Worker

همین پروژه را در Railway Deploy کن. فایل ریشهٔ `railway.toml`، Dockerfile صحیح را انتخاب می‌کند.

- یک Volume پایدار روی `/data` Mount کن.
- حداقل یک Replica همیشه‌روشن نگه دار.
- Health check برابر `/health` است.
- Variables زیر را تنظیم کن:

```text
PANEL_URL=https://YOUR-PANEL.vercel.app
COPILOT_KEY=<same-as-vercel>
WORKER_KEY=<same-as-vercel>
WORKER_ID=primary-worker
FREELANCER_PROFILE=<your-real-skills-and-experience>
PREFERRED_DOMAINS=Web/UI,WordPress/CMS
KAYA_LIST_URL=https://kaya.ir/projects
PONISHA_LIST_URL=https://ponisha.ir/search/projects
KAYA_STORAGE_STATE_PATH=/data/auth/kaya.storage-state.json
PONISHA_STORAGE_STATE_PATH=/data/auth/ponisha.storage-state.json
SCAN_INTERVAL_SECONDS=60
APPROVAL_POLL_SECONDS=2
INSPECT_LIMIT_PER_SITE=15
TOP_BIDS_PER_CYCLE=5
```

فایل‌های نشست را فقط به مسیرهای `/data/auth/` در Volume خصوصی منتقل کن. اگر انتقال مستقیم فایل در پلن Railway در دسترس نیست، محتوای Base64 هر فایل را موقتاً به‌صورت Secret با نام‌های `KAYA_STORAGE_STATE_B64` و `PONISHA_STORAGE_STATE_B64` قرار بده؛ پس از اولین Start موفق و نوشته‌شدن فایل‌ها روی Volume، این دو Variable را حذف کن.

اگر URL فهرست پروژهٔ سایت Redirect شد، بعد از ورود URL دقیق صفحهٔ فهرست را در `KAYA_LIST_URL` یا `PONISHA_LIST_URL` جایگزین کن.

## رفتار عملیاتی و ایمنی

- هر ۶۰ ثانیه هر دو سایت بررسی می‌شوند و در هر چرخه، ۵ تا ۱۰ مورد برترِ موجود برای تأیید ارسال می‌شوند.
- متن بید کوتاه، مستقیم، پروژه‌محور و بدون بخش‌های تکراری AI ساخته می‌شود.
- تأیید تلگرام یک‌بارمصرف و پیش‌فرض ۳۰ دقیقه معتبر است.
- Worker پس از تأیید، صفحه را دوباره Inspect و BID/Guard، بودجه و فیلدهای قفل‌شده را کنترل می‌کند.
- CAPTCHA، خروج از حساب، تغییر بودجه یا نتیجهٔ نامطمئن باعث توقف و هشدار می‌شود؛ دورزدن یا retry خودکار انجام نمی‌شود.
- یک Approval با `FOR UPDATE SKIP LOCKED` فقط توسط یک Worker claim می‌شود؛ ثبت تکراری مجاز نیست.

پس از استقرار، در پنل وارد «اتوماسیون» شو. Worker باید `ON` و نشست هر دو سایت باید `ready` نمایش داده شود.
