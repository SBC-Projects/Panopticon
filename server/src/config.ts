import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import type { AppConfig, SubmissionKind, WatchRoot } from "./types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const KIND_FOLDERS: { folder: string; kind: SubmissionKind }[] = [
  { folder: "Submitted files", kind: "submitted" },
  { folder: "Working files", kind: "working" },
];

export function getProjectRoot(): string {
  return ROOT;
}

/** Expand a leading "~" and resolve to an absolute path (relative to project root). */
function resolveUserPath(p: string): string {
  let expanded = p;
  if (expanded.startsWith("~")) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }
  return path.isAbsolute(expanded) ? expanded : path.resolve(ROOT, expanded);
}

export function loadConfig(): AppConfig {
  const configPath = path.join(ROOT, "config.yaml");
  if (!fs.existsSync(configPath)) {
    console.error(
      `config.yaml not found at ${configPath}\n` +
        `Copy config.example.yaml to config.yaml and edit paths to suit your machine.`
    );
    process.exit(1);
  }
  const raw = yaml.parse(fs.readFileSync(configPath, "utf8")) as Partial<AppConfig>;

  const studentWorkRoot =
    process.env.PANOPTICON_STUDENT_WORK_ROOT ?? raw.student_work_root;
  const contentRoot = studentWorkRoot ? resolveUserPath(studentWorkRoot) : ROOT;

  if (studentWorkRoot && !fs.existsSync(contentRoot)) {
    console.warn(
      `student_work_root not found: ${contentRoot} — falling back to project root.`
    );
  }

  const baseForRelativePaths = fs.existsSync(contentRoot) ? contentRoot : ROOT;

  const configured = raw.watch_roots ?? [];
  const watch_roots =
    configured.length > 0
      ? configured.map((w) => normalizeWatchRoot(w, baseForRelativePaths))
      : discoverWatchRoots(baseForRelativePaths);

  return {
    watch_roots,
    ignore_globs: raw.ignore_globs ?? [],
    poll_fallback_seconds: raw.poll_fallback_seconds ?? 30,
    server: raw.server ?? { host: "127.0.0.1", port: 8765 },
    student_work_root: baseForRelativePaths,
  };
}

function normalizeWatchRoot(w: WatchRoot, base: string): WatchRoot {
  let p = w.path;
  if (p.startsWith("~")) p = path.join(os.homedir(), p.slice(1));
  const resolved = path.isAbsolute(p) ? p : path.resolve(base, p);
  const inferred: SubmissionKind = resolved
    .toLowerCase()
    .includes("working files")
    ? "working"
    : "submitted";
  return {
    path: resolved,
    label: w.label || path.basename(resolved),
    kind: w.kind ?? inferred,
  };
}

/** Find "* - Student Work/{Submitted,Working} files" under the given base folder. */
export function discoverWatchRoots(base: string = ROOT): WatchRoot[] {
  const roots: WatchRoot[] = [];
  if (!fs.existsSync(base)) return roots;

  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.endsWith(" - Student Work")) continue;

    const label = entry.name.replace(/ - Student Work$/, "");

    for (const { folder, kind } of KIND_FOLDERS) {
      const full = path.join(base, entry.name, folder);
      if (fs.existsSync(full)) {
        roots.push({ path: full, label, kind });
      }
    }
  }

  return roots;
}
