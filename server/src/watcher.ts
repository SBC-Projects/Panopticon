import chokidar from "chokidar";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig, WatchRoot } from "./types.js";
import { parseSubmissionPath, submissionId } from "./parser.js";
import type { SubmissionStore } from "./db.js";
import type { EventBus } from "./events.js";

export type OnNewSubmission = (info: {
  id: string;
  student: string;
  assignment: string;
  filename: string;
  watch_root_label: string;
  kind: import("./types.js").SubmissionKind;
  last_modified_at: string;
}) => void;

export class SubmissionWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private config: AppConfig,
    private store: SubmissionStore,
    private events: EventBus,
    private onNew?: OnNewSubmission
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

    const root = this.config.watch_roots.find(
      (r) =>
        filePath === r.path || filePath.startsWith(r.path + path.sep)
    );
    if (!root) return;

    const parsed = parseSubmissionPath(root.path, filePath);
    if (!parsed) return;

    const { isNew } = this.store.upsertFromFile(
      root.path,
      root.label,
      root.kind,
      filePath,
      parsed,
      stat.mtime,
      stat.size
    );

    if (isNew) {
      const id = submissionId(root.path, parsed.relative_path);
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
      this.onNew?.(payload);
    }
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
