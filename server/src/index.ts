import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, getProjectRoot } from "./config.js";
import { SubmissionStore } from "./db.js";
import { EventBus } from "./events.js";
import { createRouter } from "./routes.js";
import { scanWatchRoots } from "./scanner.js";
import { SubmissionWatcher } from "./watcher.js";
import { warmAllPptxSubmissions } from "./pptx-warm.js";

const scanOnly = process.argv.includes("--scan");

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new SubmissionStore();

  if (config.watch_roots.length === 0) {
    console.error(
      "No watch roots found. Add class folders ending in '- Student Work' with a 'Submitted files' subfolder, or set watch_roots in config.yaml."
    );
    process.exit(1);
  }

  // `npm run scan` keeps the original synchronous behaviour — print "Scan
  // complete" before exit so CI / scripts can rely on it.
  if (scanOnly) {
    console.log("Scanning watch roots...");
    const scanResult = scanWatchRoots(config.watch_roots, store);
    console.log(
      `Scan complete: ${scanResult.scanned} files checked, ${scanResult.added} new entries.`
    );
    warmAllPptxSubmissions(store);
    store.close();
    return;
  }

  const events = new EventBus();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", createRouter(store, config, events));

  const distDir = path.join(getProjectRoot(), "dist");
  if (fs.existsSync(path.join(distDir, "index.html"))) {
    app.use(express.static(distDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const watcher = new SubmissionWatcher(
    config,
    store,
    events,
    (info) => {
      console.log(
        `New ${info.kind}: [${info.watch_root_label}] ${info.student} — ${info.assignment} / ${info.filename}`
      );
    },
    (row) => {
      console.log(
        `Deleted: [${row.watch_root_label}] ${row.student} — ${row.assignment} / ${row.filename}`
      );
    }
  );

  // Boot order:
  //   1. listen()   — HTTP/SSE binds; returning users see existing DB rows
  //                   immediately (no waiting on the OneDrive walk).
  //   2. watcher    — chokidar with ignoreInitial:true; only future changes.
  //   3. scan       — deferred to the next tick so listen()'s callback can
  //                   print first; emits submission-changed per new row so
  //                   the UI populates progressively over SSE.
  //
  // The OneDrive scan can take ~90 s on Windows even for a few hundred
  // files (reparse-point semantics). Running it ahead of listen() used to
  // make `npm run dev` look broken for the first minute and a half.
  const { host, port } = config.server;
  app.listen(port, host, () => {
    console.log(`Panopticon API: http://${host}:${port}`);
    if (!fs.existsSync(path.join(distDir, "index.html"))) {
      console.log(`Dev UI: run "npm run dev" and open http://localhost:5173`);
    } else {
      console.log(`Dashboard: http://${host}:${port}`);
    }
    watcher.start();
    setImmediate(() => runBackgroundScan(config.watch_roots, store, events));
  });

  const shutdown = async () => {
    await watcher.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Run the boot-time scan without blocking the HTTP server. Logs progress
 *  in the same shape `scanOnly` does so the dev terminal looks familiar.
 *  Swallows errors with a console.error — a partial scan is acceptable;
 *  killing the server post-listen is not. */
function runBackgroundScan(
  roots: import("./types.js").WatchRoot[],
  store: SubmissionStore,
  events: EventBus
): void {
  console.log("Scanning watch roots in background...");
  try {
    const scanResult = scanWatchRoots(roots, store, events);
    console.log(
      `Scan complete: ${scanResult.scanned} files checked, ${scanResult.added} new entries.`
    );
    warmAllPptxSubmissions(store);
  } catch (e) {
    console.error("Background scan failed:", e);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
