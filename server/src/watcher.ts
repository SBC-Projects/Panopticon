import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig, Submission, WatchRoot } from "./types.js";
import { parseSubmissionPath, submissionId } from "./parser.js";
import type { SubmissionStore } from "./db.js";
import type { EventBus } from "./events.js";
import { invalidateDocStats } from "./metrics.js";
import { invalidateStructure } from "./structure.js";
import { invalidatePptxCache } from "./pptx-render.js";
import { warmPptxIfChanged } from "./pptx-warm.js";

export type OnNewSubmission = (info: {
  id: string;
  student: string;
  assignment: string;
  filename: string;
  watch_root_label: string;
  kind: import("./types.js").SubmissionKind;
  last_modified_at: string;
}) => void;

export type OnDeletedSubmission = (row: Submission) => void;

/**
 * Find which configured watch root, if any, owns `filePath`. A file owns a
 * watch root iff it is the root itself OR sits inside it (the `+ path.sep`
 * guard prevents the classic sibling-prefix bug — `…/Submitted files (copy)`
 * must not match `…/Submitted files`).
 */
export function resolveWatchRoot(
  watchRoots: readonly WatchRoot[],
  filePath: string
): WatchRoot | undefined {
  return watchRoots.find(
    (r) => filePath === r.path || filePath.startsWith(r.path + path.sep)
  );
}

export class SubmissionWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private config: AppConfig,
    private store: SubmissionStore,
    private events: EventBus,
    private onNew?: OnNewSubmission,
    private onDeleted?: OnDeletedSubmission
  ) {}

  start(): void {
    const paths = this.config.watch_roots.map((r) => r.path);
    if (paths.length === 0) {
      console.warn("No watch roots configured or discovered.");
      return;
    }

    console.log("Watching:");
    for (const r of this.config.watch_roots) {
      console.log(`  [${r.label} · ${r.kind}] ${r.path}`);
    }

    this.watcher = chokidar.watch(paths, {
      ignored: (p) => this.isIgnored(p),
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 200,
      },
      depth: 99,
    });

    const handler = (filePath: string) => {
      this.scheduleProcess(filePath);
    };

    this.watcher.on("add", handler);
    this.watcher.on("change", handler);
    this.watcher.on("unlink", (filePath) => this.processDelete(filePath));

    if (this.config.poll_fallback_seconds > 0) {
      this.pollTimer = setInterval(
        () => this.pollAll(),
        this.config.poll_fallback_seconds * 1000
      );
    }
  }

  private isIgnored(p: string): boolean {
    const base = path.basename(p);
    if (base.startsWith("~$")) return true;
    if (base === "desktop.ini") return true;
    if (p.endsWith(".tmp")) return true;
    return false;
  }

  private scheduleProcess(filePath: string): void {
    const key = filePath;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.processFile(filePath);
      }, 1500)
    );
  }

  private processFile(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (!stat.isFile()) return;

    const root = resolveWatchRoot(this.config.watch_roots, filePath);
    if (!root) return;

    const parsed = parseSubmissionPath(root.path, filePath);
    if (!parsed) return;

    const { isNew, contentChanged } = this.store.upsertFromFile(
      root.path,
      root.label,
      root.kind,
      filePath,
      parsed,
      stat.mtime,
      stat.size
    );

    const id = submissionId(root.path, parsed.relative_path);

    if (contentChanged) {
      const payload = {
        id,
        student: parsed.student,
        assignment: parsed.assignment,
        filename: parsed.filename,
        watch_root_label: root.label,
        kind: root.kind,
        last_modified_at: stat.mtime.toISOString(),
      };
      this.events.emit({ type: "submission-changed", ...payload });
      if (isNew) this.onNew?.(payload);

      warmPptxIfChanged(
        {
          id,
          filename: parsed.filename,
          absolute_path: filePath,
          last_modified_at: stat.mtime.toISOString(),
          size_bytes: stat.size,
        },
        true
      );
    }
  }

  /**
   * React to a chokidar `unlink` event. Not debounced — the file is already
   * gone, there's nothing to coalesce. Cancels any pending edit-debounce for
   * the same path so a save-as-replace (unlink + add) doesn't briefly delete
   * the row before re-inserting it.
   */
  private processDelete(filePath: string): void {
    const pendingTimer = this.debounceTimers.get(filePath);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.debounceTimers.delete(filePath);
    }

    const root = resolveWatchRoot(this.config.watch_roots, filePath);
    if (!root) return;

    const parsed = parseSubmissionPath(root.path, filePath);
    if (!parsed) return;

    const id = submissionId(root.path, parsed.relative_path);
    const deleted = this.store.deleteById(id);
    if (!deleted) return;

    invalidateDocStats(id);
    invalidateStructure(id);
    // Cheap no-op for non-pptx ids (force:true on a missing dir).
    invalidatePptxCache(id);

    this.events.emit({
      type: "submission-deleted",
      id: deleted.id,
      student: deleted.student,
      assignment: deleted.assignment,
      watch_root_label: deleted.watch_root_label,
    });
    this.onDeleted?.(deleted);
  }

  private pollAll(): void {
    for (const root of this.config.watch_roots) {
      this.walkAndProcess(root);
    }
  }

  private walkAndProcess(root: WatchRoot): void {
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && !this.isIgnored(full)) this.processFile(full);
      }
    };
    if (fs.existsSync(root.path)) walk(root.path);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    await this.watcher?.close();
  }
}
