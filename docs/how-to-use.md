# How to Use Panopticon

A guide for teachers using Panopticon day-to-day on their own PC.

> If you just want to install and run it, the **[root README](../README.md)** has the 30-second version. This doc goes deeper.

---

## 1. What Panopticon does

Panopticon is a **local dashboard** for the submission folders Microsoft Teams creates for each of your classes. It watches the files that OneDrive syncs to your PC and shows them in a single live view — both **drafts being written right now** and **work that's been turned in**.

It does not:
- Connect to Microsoft 365 or any cloud service.
- Send any data anywhere.
- Require any admin permissions, app registrations, or installs beyond Node.js.

Everything is on your machine. If you close the laptop, the dashboard is gone until you reopen it.

---

## 2. One-time setup

### 2.1 Add OneDrive shortcuts to your class folders

For each class, in Teams or the SharePoint web app, find the **Student Work** library and add a OneDrive shortcut to:

- `Submitted files/` (turned-in work)
- `Working files/` (live drafts) — optional but recommended

The shortcuts should appear on disk under your OneDrive folder, named like:

```
9 Digital Technology Class 1A - Student Work/
├── Submitted files/
└── Working files/
```

The folder must end in `- Student Work` for auto-detection to work.

### 2.2 Install Node.js

Install the **LTS** build from [nodejs.org](https://nodejs.org). After it's installed, open PowerShell and confirm:

```powershell
node --version    # should print v22.x or newer
npm --version
```

### 2.3 Configure Panopticon

Copy the example config:

```powershell
cp config.example.yaml config.yaml
```

Open `config.yaml` and set `student_work_root` to the folder that contains your `* - Student Work` shortcuts. Usually this is somewhere under your OneDrive:

```yaml
student_work_root: "C:/Users/<you>/OneDrive - <org>/Panopticon"
```

If you'd rather not edit the file, set the environment variable instead:

```powershell
$env:PANOPTICON_STUDENT_WORK_ROOT = "C:/Users/<you>/OneDrive - <org>/Panopticon"
```

Leave `watch_roots: []` to let Panopticon discover every `* - Student Work` folder under that root. Or list them manually if you want to ignore some.

### 2.4 Install dependencies

From the project folder:

```powershell
npm install
```

---

## 3. Running it day-to-day

### Development (with hot-reload UI)

```powershell
npm run dev
```

- API + watcher: `http://127.0.0.1:8765`
- Dashboard (auto-reloads as you edit code): `http://localhost:5173`

### Production (single command)

```powershell
npm run build
npm start
```

Then open `http://127.0.0.1:8765`. The built UI is served by the same process that runs the watcher.

### Just scan once and exit

Useful for catching up after a long OneDrive sync, without leaving anything running:

```powershell
npm run scan
```

---

## 4. The dashboard

Panopticon has two views, switchable with the toggle in the header.

### 4.1 Browse mode

A traditional list-and-preview layout for catching up on submissions.

- **Sidebar** — every file Panopticon has indexed, newest first.
- **Filters**: New only, kind (Submitted / Working / Both), class, student search, assignment.
- **Preview pane** — `.docx` rendered to HTML, PDFs and images embedded, anything else gets an "Open in Word" button.
- **Mark all seen** — clears the NEW badges. Anything that changes afterwards comes back as NEW.

Use Browse mode when you're catching up after the fact — grading turned-in work, scanning across classes, reading a single document end-to-end.

### 4.2 Live Monitor mode

An assignment-centric view for watching students as they work.

- **Pick a class** from the top bar, then an **assignment**.
- The left side fills with one card per student in that assignment. Each card shows:
  - Activity dot (green pulse = editing now, amber = recent, grey = idle).
  - Kind badge (DRAFT or TURNED IN).
  - Word count.
  - A short excerpt of the document.
  - When it was last modified.
- The right side shows **metrics** for the selected student, or a **class summary** when nothing is selected.
- **Question dropdown** (when the doc has headings) jumps the preview to that question.

Use Live Monitor during a class to see who's writing, who's stuck, and who hasn't started.

---

## 5. How submissions get into Panopticon

```
Student saves work in Teams
        │
        ▼
SharePoint stores it under
  • Working files/{student}/{assignment}/...   (drafts → DRAFT badge)
  • Submitted files/{student}/{assignment}/... (turned in → TURNED IN badge)
        │
        ▼
OneDrive syncs to your PC (seconds–minutes)
        │
        ▼
Panopticon watcher picks it up and marks it NEW
```

OneDrive sync is the bottleneck. If files aren't showing up:

1. Check OneDrive is running and signed in.
2. Confirm the file is actually on disk (right-click → "Always keep on this device" if it's cloud-only).
3. Click **Scan folders** in the Panopticon header — it forces a full re-walk.

---

## 6. Common tasks

### "I want to see who is writing right now"

Switch to **Live Monitor** → pick the class → pick today's assignment. Cards with a green pulse are being edited in the last 60 seconds.

### "I want to grade everything that's been turned in"

Stay in **Browse** mode → set Kind = **Submitted only** → optionally filter by class. Work down the list.

### "I just had a sync hiccup"

Click **Scan folders** in the header. This forces a re-walk of every configured watch root.

### "I want to open a file in Word"

In Browse mode the preview pane has an **Open in Word** button. In Live Monitor mode it's in the right-side metrics panel.

### "I want to start fresh"

Stop the server (Ctrl-C). Delete `data/panopticon.db`. Start the server again. Panopticon will re-scan all watch roots and re-mark everything as NEW.

---

## 7. Configuration reference

`config.yaml` (gitignored — your machine, your settings).

| Key | Default | What it does |
|-----|---------|--------------|
| `student_work_root` | project root | Folder Panopticon scans for `* - Student Work` subfolders. Override with `PANOPTICON_STUDENT_WORK_ROOT` env var. |
| `watch_roots` | `[]` (auto-detect) | Explicit list of folders to watch. Useful if you want to skip some classes. |
| `ignore_globs` | OneDrive temp files | Patterns to ignore inside watch roots. |
| `poll_fallback_seconds` | `30` | Safety-net poll interval. Chokidar handles the fast path. |
| `server.host` | `127.0.0.1` | The HTTP server binds here. Loopback only by design. |
| `server.port` | `8765` | API + (in prod) UI port. |

Explicit `watch_roots` example:

```yaml
watch_roots:
  - path: "./9 Digital Technology Class 1A - Student Work/Submitted files"
    label: "9 Digital Tech 1A"
  - path: "./9 Digital Technology Class 1A - Student Work/Working files"
    label: "9 Digital Tech 1A"
    kind: working
```

Relative paths resolve against `student_work_root` (or the project root if it isn't set).

---

## 8. Troubleshooting

| Symptom | Try |
|---------|-----|
| `config.yaml not found` | Run `cp config.example.yaml config.yaml`, then re-run `npm run dev`. |
| `No watch roots found` | Either set `student_work_root` to your OneDrive path, or add a `watch_roots:` entry manually. |
| Dashboard is blank | Open DevTools → Console. Most often the API isn't running. Check the other terminal. |
| Files aren't appearing | Click **Scan folders**. If still empty, confirm the file is actually on disk (not "online-only" in OneDrive). |
| Live dot is red | Server died or restarted. SSE will reconnect automatically every 2 seconds. |
| Word count is wrong | Word counts come from `mammoth`'s raw-text extraction. Whitespace-separated tokens. Don't expect Word-identical numbers. |

If something else is broken, see [`workflows/debugging.md`](./workflows/debugging.md) for the dev-side toolkit.

---

## 9. Privacy

- All data stays on your PC.
- The HTTP server binds to `127.0.0.1` only — not reachable from the LAN.
- Nothing is uploaded.
- `data/panopticon.db` is local; delete it whenever you want.
