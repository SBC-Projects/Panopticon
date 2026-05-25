# Panopticon

Monitor student Teams assignment submissions locally — no Microsoft app registration required.

Teams stores turned-in files in SharePoint **Student Work → Submitted files**. Add shortcuts to this project folder via OneDrive; Panopticon watches those synced paths and shows new submissions in a dashboard with Word preview.

## Setup

1. **Class folders** — Place OneDrive shortcuts in this folder, named like:
   - `9 Digital Technology Class 1A - Student Work`
   - Each must contain a `Submitted files` subfolder.

2. **Install Node.js** (LTS from [nodejs.org](https://nodejs.org)) if you do not have `npm` in a terminal yet.

3. **Create your local config** — copy the example, then edit paths:

   ```bash
   cp config.example.yaml config.yaml
   ```

   `config.yaml` is gitignored so machine-specific paths and folder names stay off the repo.

4. **Install and run**

   ```bash
   npm install
   npm run dev
   ```

   - API + file watcher: `http://127.0.0.1:8765`
   - Dashboard: `http://localhost:5173`

5. **Production** (single command after build):

   ```bash
   npm run build
   npm start
   ```

   Open `http://127.0.0.1:8765`

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server + Svelte UI with hot reload |
| `npm run scan` | Scan all watch folders once and exit |
| `npm start` | Run API, watcher, and built UI |

## Configuration

Edit [`config.yaml`](config.yaml). Leave `watch_roots: []` to **auto-detect** any `* - Student Work/Submitted files` folder in the discovery root.

By default the discovery root is the project folder. If your OneDrive shortcuts live elsewhere (e.g. the app is in `Documents` but the class folders are still synced inside OneDrive), point `student_work_root` at that folder:

```yaml
student_work_root: "C:/Users/<you>/OneDrive - <org>/Panopticon"
```

You can also set the `PANOPTICON_STUDENT_WORK_ROOT` environment variable to override it.

To add a class manually:

```yaml
watch_roots:
  - path: "./9 Digital Technology Class 1A - Student Work/Submitted files"
    label: "9 Digital Tech 1A"
```

Relative `path` values are resolved against `student_work_root` (or the project root if it isn't set).

## How submissions appear

1. Student uploads or edits work in Teams.
2. **Drafts** land in SharePoint `Working files/{Student}/{Assignment}/…` (tagged **DRAFT**).
3. After **Turn In**, the file is copied to `Submitted files/...` (tagged **TURNED IN**).
4. OneDrive syncs to your PC (seconds to minutes).
5. Panopticon marks each new/changed file **NEW** until you click **Mark all seen**.

Use the **Submitted / Working / Both** filter in the sidebar to switch between live drafts and final turn-ins.

## Preview

- **`.docx`** — converted to HTML in the app (good for reading; not identical to Word).
- **PDF / images** — embedded viewer.
- **Open in Word** — opens the synced file in desktop Word.

## Privacy

All data stays on your machine. Nothing is uploaded to external services.
