import fs from "node:fs";
import path from "node:path";
import type { WatchRoot } from "./types.js";
import { parseSubmissionPath, shouldIgnoreFile } from "./parser.js";
import type { SubmissionStore } from "./db.js";

function walkDir(dir: string, files: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (entry.isFile() && !shouldIgnoreFile(entry.name)) {
      files.push(full);
    }
  }
}

export function scanWatchRoots(
  roots: WatchRoot[],
  store: SubmissionStore
): { scanned: number; added: number } {
  let scanned = 0;
  let added = 0;

  for (const root of roots) {
    if (!fs.existsSync(root.path)) {
      console.warn(`Watch root not found: ${root.path}`);
      continue;
    }

    const files: string[] = [];
    walkDir(root.path, files);

    for (const filePath of files) {
      scanned++;
      const parsed = parseSubmissionPath(root.path, filePath);
      if (!parsed) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      const { isNew } = store.upsertFromFile(
        root.path,
        root.label,
        root.kind,
        filePath,
        parsed,
        stat.mtime,
        stat.size
      );
      if (isNew) added++;
    }
  }

  return { scanned, added };
}
