# Setup Guide — what *you* need to do

Plain steps to get Attendance OS live. No prior experience needed.

> **🖥️ Easiest path — the desktop app.** One program you install, open, and it
> fetches punches from the device and shows reports. See
> **[desktop/README.md](desktop/README.md)**. You still do **Part 1 (Database)**
> below once; then, instead of Parts 2–3, you just open the app and paste your
> keys into its **Settings** screen.
>
> Parts 2 & 3 below are the **manual / advanced** way (run the catcher and the
> website separately) — use them only if you'd rather not use the app.

## Before you start — you need

- [ ] The **always-on PC** that sits in the office on the **same Wi-Fi as the device** (SSID `Haseebmadeit`). This runs the "listener".
- [ ] **Node.js 18 or newer** installed on that PC → https://nodejs.org (click the "LTS" button, install).
- [ ] A free **Supabase** account → https://supabase.com
- [ ] This project folder copied onto that PC.

> Tip: to check Node is installed, open a terminal (Mac: *Terminal*; Windows: *PowerShell*) and type `node -v`. You should see a version like `v20.x`.

---

## Part 1 — Database (Supabase) · ~10 min

### 1.1 Create the project
1. Sign in to Supabase → **New project**.
2. Give it a name, set a database password (save it somewhere), pick a region near you → **Create**. Wait ~2 min for it to finish.

### 1.2 Copy your 3 keys
Open **Project Settings** (gear icon) → **API**. Keep this tab open — you'll paste these in Parts 2 and 3:

| You'll see | Use it for |
|---|---|
| **Project URL** (e.g. `https://abcd.supabase.co`) | both listener and dashboard |
| **`anon` / `public`** key | the **dashboard** |
| **`service_role` / `secret`** key | the **listener** (keep this one private!) |

> ⚠️ The **service_role** key is powerful. It goes **only** in the listener, never in the dashboard or anywhere public.

### 1.3 (Optional, recommended) Turn on the nightly recompute
**Database** → **Extensions** → search **`pg_cron`** → toggle it **on**. Do this *before* the next step.
(Skip it if you like — attendance still recomputes instantly on every punch; this just adds a nightly safety pass.)

### 1.4 Create the tables (one paste)
1. Left sidebar → **SQL Editor** → **New query**.
2. Open the file **`supabase/setup.sql`** from this project, copy **everything**, paste it in.
3. Click **Run**. You should see "Success". (Grey "NOTICE" lines are normal.)

That's the whole database — tables, security, and the attendance logic.

### 1.5 (Optional) Add test data
Want a test employee mapped to device PIN `2` so you can try reports immediately?
New query → paste the contents of **`supabase/seed.sql`** → **Run**.

### 1.6 Turn on the live feed
**Database** → **Replication** (or **Publications**) → open **`supabase_realtime`** → enable the **`raw_punches`** table.
(This makes the dashboard's live punch feed update by itself. Without it, the feed still works with a Refresh button.)

### 1.7 Make your login
**Authentication** → **Users** → **Add user** → **Create new user**.
Enter your email + a password, tick **Auto Confirm User**, **Create**. This is how you'll sign into the dashboard.

✅ **Database done.**

---

## Part 2 — Listener (captures punches) · ~10 min

Do this on the **always-on office PC**. Open a terminal **in the project folder**.

### 2.1 Settings file
```bash
cd listener
cp .env.example .env        # Windows PowerShell: copy .env.example .env
```
Open the new **`.env`** file in a text editor and fill in two lines from step 1.2:
```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR-service_role-KEY
```
(Leave `DEVICE_SN` and the rest as they are — they're already correct for your device.)

### 2.2 Install and test
```bash
npm install
npm run simulate     # pretends to be the device — proves the whole path works
```
If you added test data (1.5), open the dashboard later and you'll see those punches.

### 2.3 Run it (and keep it running)
Quick start:
```bash
npm start            # leave this window open; punches now flow to Supabase
```
To keep it running forever (survives reboots) — **recommended**:
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup          # then copy-paste the command it prints, and run it
pm2 save
```

### 2.4 Network checklist (one-time)
- [ ] This PC is on Wi-Fi **`Haseebmadeit`** (the same one the device uses).
- [ ] This PC's IP is **`192.168.1.202`** (set a static IP or a router "DHCP reservation").
- [ ] Allow **port 8081** through the PC's firewall.
- [ ] **Never** forward port 8081 to the internet.

The device is already set to send to `192.168.1.202:8081`, so there's nothing to change on the device.

✅ **Listener done.** Real face/fingerprint scans now land in your database.

---

## Part 3 — Dashboard (the website you use) · ~10 min

Can be the same PC or any computer.

### 3.1 Settings file
```bash
cd dashboard
cp .env.example .env        # Windows: copy .env.example .env
```
Open **`.env`** and fill in (from step 1.2 — the **anon** key this time):
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-anon-public-KEY
```

### 3.2 Install and open
```bash
npm install
npm run dev
```
Open the link it prints (**http://localhost:5173**) and **sign in** with the email/password from step 1.7.

### 3.3 (Later) Put it online for everyone
When you want it on a real web address, build it and host the `dist/` folder on any free static host (Netlify, Vercel, Cloudflare Pages):
```bash
npm run build        # creates the dist/ folder to upload
```

✅ **Dashboard done.**

---

## Is it working? (2-minute check)

1. Listener running (Part 2.3) and **`npm run simulate`** prints `OK` lines.
2. In the dashboard → **Overview**: the device shows **online**, and the **live feed** shows the simulated punches.
3. Map a real PIN: **Employees** → add an employee → map their device **PIN** to them.
4. Have someone scan their face/finger → it appears in the live feed within ~1 second.
5. **Reports** → **Total Time Card** → pick today's date → see their hours.

---

## If something's not right

| Symptom | Fix |
|---|---|
| Dashboard says "Missing VITE_SUPABASE…" | The `.env` in `dashboard/` is empty or wrong. Re-check step 3.1, then restart `npm run dev`. |
| Can't sign in | Create the user in **Authentication → Users** and tick **Auto Confirm User** (step 1.7). |
| Live feed doesn't auto-update | Turn on realtime for `raw_punches` (step 1.6). Until then, use the **Refresh** button. |
| Device shows **offline** (Overview) | The listener isn't running, or the PC isn't on Wi-Fi `Haseebmadeit` / IP `.202`. The device keeps punches and syncs when it's back. |
| Punches show as **"Unknown (PIN …)"** | That PIN isn't mapped yet → **Employees** → map it (step in the "Unmapped PINs" box). |
| Listener prints "buffered (supabase down)" | Your `SUPABASE_URL`/`SERVICE_KEY` is wrong, or no internet. Fix `.env`; buffered punches send automatically once fixed — none are lost. |

Need a hand with any step? Tell me which part number you're on.
