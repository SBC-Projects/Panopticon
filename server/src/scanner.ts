import fs from "node:fs";
import path from "node:path";
import type { WatchRoot } from "./types.js";
import {
  parseSubmissionPath,
  shouldIgnoreFile,
  submissionId,
} from "./parser.js";
import type { SubmissionStore } from "./db.js";
import type { EventBus } from "./events.js";

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

/**
 * One-shot recursive walk of every configured watch root. Upserts each file
 * into the store. When `events` is supplied, emits a `submission-changed`
 * event for every row that was new — this is what makes the deferred-scan
 * boot path progressive: the HTTP server binds first, then this runs in
 * the background, and connected clients see rows trickle in over SSE.
 *
 * Symmetrical with `SubmissionWatcher.processFile` — the event shape is
 * identical, so client reconcilers don't need to know which side produced
 * the event.
 */
export function scanWatchRoots(
  roots: WatchRoot[],
  store: SubmissionStore,
  events?: EventBus
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
      if (isNew) {
        added++;
        if (events) {
          events.emit({
            type: "submission-changed",
            id: submissionId(root.path, parsed.relative_path),
            student: parsed.student,
            assignment: parsed.assignment,
            filename: parsed.filename,
            watch_root_label: root.label,
            kind: root.kind,
            last_modified_at: stat.mtime.toISOString(),
          });
        }
      }
    }
  }

  return { scanned, added };
}
