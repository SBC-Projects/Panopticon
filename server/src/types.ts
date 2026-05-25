export type SubmissionKind = "submitted" | "working";

export interface WatchRoot {
  path: string;
  label: string;
  kind: SubmissionKind;
}

export interface AppConfig {
  watch_roots: WatchRoot[];
  ignore_globs: string[];
  poll_fallback_seconds: number;
  server: { host: string; port: number };
  /** Folder to scan for "* - Student Work" subfolders. Defaults to project root. */
  student_work_root?: string;
}

export interface Submission {
  id: string;
  watch_root_label: string;
  kind: SubmissionKind;
  student: string;
  assignment: string;
  filename: string;
  relative_path: string;
  absolute_path: string;
  extension: string;
  size_bytes: number;
  first_seen_at: string;
  last_modified_at: string;
  status: "new" | "seen";
}

export interface ParsedPath {
  student: string;
  assignment: string;
  filename: string;
  relative_path: string;
}
