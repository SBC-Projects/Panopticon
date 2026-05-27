#!/usr/bin/env node
// scripts/dev.mjs — sequenced dev orchestrator.
//
// Replaces `concurrently` for `npm run dev`. The old setup launched
// `tsx watch server/src/index.ts` and `vite` in parallel; on Windows the two
// fought for filesystem I/O while OneDrive's reparse-point semantics were
// also being walked by the server's boot-time scan. The result was a hang
// of 30–90 s (or, with bad luck, indefinitely), plus orphaned `tsx watch`
// processes after Ctrl-C that held a lock on `data/panopticon.db`.
//
// This script avoids both:
//   1. Start the server (`npm run dev:server`).
//   2. Wait until it prints `Panopticon API:` — that line comes from inside
//      `app.listen()`'s callback in server/src/index.ts, after which the
//      background OneDrive scan runs without blocking HTTP.
//   3. Only then start Vite (`npm run dev:web`).
//   4. On shutdown, walk the child process tree (Windows: `taskkill /T /F`)
//      so tsx-watch's grandchildren don't survive and lock the DB.
//
// No new top-level dependencies — node:child_process + ANSI prefixes only.
// `npm run dev:server` and `npm run dev:web` remain available individually
// for the rare case the orchestrator gets in the way.

import { spawn } from "node:child_process";
import process from "node:process";

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

const colours = {
  server: "\x1b[34m",
  web: "\x1b[32m",
  meta: "\x1b[90m",
  reset: "\x1b[0m",
};

const SERVER_READY_LINE = /Panopticon API:/;
const SERVER_READY_TIMEOUT_MS = 60_000;

let shuttingDown = false;
let server = null;
let web = null;

function meta(message) {
  process.stdout.write(`${colours.meta}[dev]    ${message}${colours.reset}\n`);
}

function pipeWithPrefix(stream, label, colour, sink) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      sink.write(`${colour}[${label}]${colours.reset} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      sink.write(`${colour}[${label}]${colours.reset} ${buffer}\n`);
    }
  });
}

function spawnNpmScript(scriptName) {
  return spawn(npm, ["run", scriptName], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin,
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (isWin) {
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    } catch {
      // fall through to SIGTERM
    }
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // child may have exited between the guard and here; ignore.
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  meta(`received ${signal}, stopping children…`);
  killTree(web);
  killTree(server);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => shutdown(sig));
}

function waitForServerReady() {
  return new Promise((resolve) => {
    let resolved = false;
    const settle = (reason) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(reason);
    };
    const timer = setTimeout(() => settle("timeout"), SERVER_READY_TIMEOUT_MS);
    server.stdout.on("data", (chunk) => {
      if (SERVER_READY_LINE.test(chunk.toString())) settle("ready");
    });
    server.on("exit", () => settle("exited"));
  });
}

async function main() {
  meta("starting server (npm run dev:server)…");
  server = spawnNpmScript("dev:server");
  pipeWithPrefix(server.stdout, "server", colours.server, process.stdout);
  pipeWithPrefix(server.stderr, "server", colours.server, process.stderr);
  server.on("exit", (code, signal) => {
    meta(`server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    killTree(web);
    if (!shuttingDown) process.exit(code ?? 1);
  });

  const readyReason = await waitForServerReady();
  if (readyReason === "exited") {
    return;
  }
  if (readyReason === "timeout") {
    meta(
      `server didn't print "Panopticon API:" within ${SERVER_READY_TIMEOUT_MS / 1000}s — starting Vite anyway`
    );
  } else {
    meta("server is up — starting Vite (npm run dev:web)…");
  }

  web = spawnNpmScript("dev:web");
  pipeWithPrefix(web.stdout, "web", colours.web, process.stdout);
  pipeWithPrefix(web.stderr, "web", colours.web, process.stderr);
  web.on("exit", (code, signal) => {
    meta(`web exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    killTree(server);
    if (!shuttingDown) process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err);
  shutdown("SIGTERM");
  process.exit(1);
});
