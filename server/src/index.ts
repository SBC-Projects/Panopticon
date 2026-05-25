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

  console.log("Scanning watch roots...");
  const scanResult = scanWatchRoots(config.watch_roots, store);
  console.log(
    `Scan complete: ${scanResult.scanned} files checked, ${scanResult.added} new entries.`
  );

  if (scanOnly) {
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

  const watcher = new SubmissionWatcher(config, store, events, (info) => {
    console.log(
      `New ${info.kind}: [${info.watch_root_label}] ${info.student} — ${info.assignment} / ${info.filename}`
    );
  });
  watcher.start();

  const { host, port } = config.server;
  app.listen(port, host, () => {
    console.log(`Panopticon API: http://${host}:${port}`);
    if (!fs.existsSync(path.join(distDir, "index.html"))) {
      console.log(`Dev UI: run "npm run dev" and open http://localhost:5173`);
    } else {
      console.log(`Dashboard: http://${host}:${port}`);
    }
  });

  const shutdown = async () => {
    await watcher.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
