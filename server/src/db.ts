import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./config.js";
import { submissionId } from "./parser.js";
import type { ParsedPath, Submission, SubmissionKind } from "./types.js";

const DATA_DIR = path.join(getProjectRoot(), "data");

export function getDbPath(): string {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, "panopticon.db");
}

export class SubmissionStore {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(getDbPath());
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        watch_root TEXT NOT NULL,
        watch_root_label TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'submitted',
        student TEXT NOT NULL,
        assignment TEXT NOT NULL,
        filename TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        extension TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_modified_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new'
      );
    `);

    const cols = this.db
      .prepare("PRAGMA table_info(submissions)")
      .all() as { name: string }[];
    if (!cols.some((c) => c.name === "kind")) {
      this.db.exec(
        "ALTER TABLE submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'submitted'"
      );
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
      CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment);
      CREATE INDEX IF NOT EXISTS idx_submissions_kind ON submissions(kind);
    `);
  }

  upsertFromFile(
    watchRoot: string,
    watchRootLabel: string,
    kind: SubmissionKind,
    absolutePath: string,
    parsed: ParsedPath,
    mtime: Date,
    size: number
  ): { isNew: boolean; contentChanged: boolean } {
    const id = submissionId(watchRoot, parsed.relative_path);
    const ext = path.extname(parsed.filename).toLowerCase();
    const now = new Date().toISOString();
    const mtimeIso = mtime.toISOString();

    const existing = this.db
      .prepare(
        "SELECT first_seen_at, last_modified_at, size_bytes, status FROM submissions WHERE id = ?"
      )
      .get(id) as
      | {
          first_seen_at: string;
          last_modified_at: string;
          size_bytes: number;
          status: string;
        }
      | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO submissions (
            id, watch_root, watch_root_label, kind, student, assignment, filename,
            relative_path, absolute_path, extension, size_bytes,
            first_seen_at, last_modified_at, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
        )
        .run(
          id,
          watchRoot,
          watchRootLabel,
          kind,
          parsed.student,
          parsed.assignment,
          parsed.filename,
          parsed.relative_path,
          absolutePath,
          ext,
          size,
          now,
          mtimeIso
        );
      return { isNew: true, contentChanged: true };
    }

    const contentChanged =
      existing.last_modified_at !== mtimeIso ||
      existing.size_bytes !== size;
    const status =
      contentChanged && existing.status === "seen" ? "new" : existing.status;

    this.db
      .prepare(
        `UPDATE submissions SET
          absolute_path = ?, size_bytes = ?, last_modified_at = ?,
          status = ?, filename = ?, assignment = ?, student = ?, kind = ?
        WHERE id = ?`
      )
      .run(
        absolutePath,
        size,
        mtimeIso,
        status,
        parsed.filename,
        parsed.assignment,
        parsed.student,
        kind,
        id
      );

    return { isNew: contentChanged && status === "new", contentChanged };
  }

  list(filters?: {
    status?: string;
    assignment?: string;
    watch_root_label?: string;
    student?: string;
    kind?: string;
  }): Submission[] {
    let sql = "SELECT * FROM submissions WHERE 1=1";
    const params: (string | number)[] = [];

    if (filters?.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }
    if (filters?.assignment) {
      sql += " AND assignment = ?";
      params.push(filters.assignment);
    }
    if (filters?.watch_root_label) {
      sql += " AND watch_root_label = ?";
      params.push(filters.watch_root_label);
    }
    if (filters?.student) {
      sql += " AND student LIKE ?";
      params.push(`%${filters.student}%`);
    }
    if (filters?.kind) {
      sql += " AND kind = ?";
      params.push(filters.kind);
    }

    sql += " ORDER BY last_modified_at DESC";

    return this.db.prepare(sql).all(...params) as unknown as Submission[];
  }

  getById(id: string): Submission | undefined {
    return this.db
      .prepare("SELECT * FROM submissions WHERE id = ?")
      .get(id) as Submission | undefined;
  }

  /**
   * Remove a row and return the snapshot of what was deleted, so the caller
   * (typically the watcher's `unlink` handler) can build an event payload
   * before the row is gone. Returns `undefined` when no row matched —
   * which is the common case for files we were never tracking
   * (lock files, OneDrive sidecars, etc.).
   */
  deleteById(id: string): Submission | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    this.db.prepare("DELETE FROM submissions WHERE id = ?").run(id);
    return existing;
  }

  markAllSeen(): number {
    const result = this.db
      .prepare("UPDATE submissions SET status = 'seen' WHERE status = 'new'")
      .run();
    return Number(result.changes ?? 0);
  }

  markSeen(id: string): void {
    this.db
      .prepare("UPDATE submissions SET status = 'seen' WHERE id = ?")
      .run(id);
  }

  getSummary(): {
    total: number;
    new_count: number;
    by_class: {
      label: string;
      total: number;
      new_count: number;
      submitted_count: number;
      working_count: number;
    }[];
    assignments: { assignment: string; watch_root_label: string; count: number }[];
  } {
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM submissions").get() as {
        c: number;
      }
    ).c;
    const new_count = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM submissions WHERE status = 'new'")
        .get() as { c: number }
    ).c;

    const by_class = this.db
      .prepare(
        `SELECT watch_root_label as label,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
                SUM(CASE WHEN kind = 'submitted' THEN 1 ELSE 0 END) as submitted_count,
                SUM(CASE WHEN kind = 'working' THEN 1 ELSE 0 END) as working_count
         FROM submissions GROUP BY watch_root_label`
      )
      .all() as {
        label: string;
        total: number;
        new_count: number;
        submitted_count: number;
        working_count: number;
      }[];

    const assignments = this.db
      .prepare(
        `SELECT assignment, watch_root_label, COUNT(*) as count
         FROM submissions GROUP BY assignment, watch_root_label
         ORDER BY count DESC`
      )
      .all() as { assignment: string; watch_root_label: string; count: number }[];

    return {
      total,
      new_count,
      by_class: by_class.map((r) => ({
        ...r,
        new_count: Number(r.new_count),
        submitted_count: Number(r.submitted_count),
        working_count: Number(r.working_count),
      })),
      assignments,
    };
  }

  close(): void {
    this.db.close();
  }
}
