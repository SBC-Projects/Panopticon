export type SubmissionKind = "submitted" | "working";

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

export interface Summary {
  total: number;
  new_count: number;
  by_class: {
    label: string;
    total: number;
    new_count: number;
    submitted_count: number;
    working_count: number;
  }[];
  assignments: {
    assignment: string;
    watch_root_label: string;
    count: number;
  }[];
}

/**
 * One rendered slide inside a `.pptx` preview. `image_path` is a
 * server-relative URL like `/api/preview/<id>/slide/<n>`; clients
 * append `?v=<last_modified_at>` for cache-busting via `slideUrl`.
 */
export interface SlideRef {
  index: number;
  title: string;
  image_path: string;
}

export type PreviewResponse =
  | { type: "html"; html: string; last_modified_at: string }
  | { type: "binary"; mime: string; last_modified_at: string }
  | { type: "slides"; slides: SlideRef[]; last_modified_at: string }
  | {
      type: "empty";
      reason: "not_downloaded" | "empty_body" | "render_unavailable";
      message: string;
      last_modified_at: string;
    }
  | { type: "unsupported"; message: string; last_modified_at: string }
  | { type: "error"; message: string; last_modified_at: string };

const API = "/api";

export async function fetchSummary(): Promise<Summary> {
  const res = await fetch(`${API}/summary`);
  if (!res.ok) throw new Error("Failed to load summary");
  return res.json();
}

export async function fetchSubmissions(params?: {
  status?: string;
  assignment?: string;
  class?: string;
  student?: string;
  kind?: SubmissionKind;
}): Promise<Submission[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.assignment) q.set("assignment", params.assignment);
  if (params?.class) q.set("class", params.class);
  if (params?.student) q.set("student", params.student);
  if (params?.kind) q.set("kind", params.kind);
  const res = await fetch(`${API}/submissions?${q}`);
  if (!res.ok) throw new Error("Failed to load submissions");
  return res.json();
}

export async function markAllSeen(): Promise<number> {
  const res = await fetch(`${API}/submissions/mark-seen`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to mark seen");
  const data = await res.json();
  return data.marked;
}

export async function fetchPreview(id: string): Promise<PreviewResponse> {
  const res = await fetch(`${API}/preview/${id}`);
  if (!res.ok) throw new Error("Failed to load preview");
  return res.json();
}

export function fileUrl(id: string): string {
  return `${API}/file/${id}`;
}

/**
 * Build a cache-busting URL for one rendered pptx slide. Pair with a
 * `SlideRef.image_path` returned by the preview endpoint. The `v=`
 * query forces a reload when the source deck changes; without it the
 * server's `Cache-Control: immutable` would stick.
 */
export function slideUrl(imagePath: string, mtime: string): string {
  return `${imagePath}?v=${encodeURIComponent(mtime)}`;
}

export async function openInApp(id: string): Promise<void> {
  const res = await fetch(`${API}/open/${id}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to open file");
  }
}

export async function triggerScan(): Promise<{ scanned: number; added: number }> {
  const res = await fetch(`${API}/scan`, { method: "POST" });
  if (!res.ok) throw new Error("Scan failed");
  return res.json();
}

export type ExcerptStatus =
  | "ok"
  | "empty_body"
  | "not_downloaded"
  | "missing"
  | "unsupported_ext"
  | "parse_error"
  | "not_submitted";

/**
 * Pointer to a "draft elsewhere" — when the row the teacher is looking at
 * is empty/missing AND the same student has a non-empty file in the OTHER
 * watch-root kind, the server gives us enough to render an inline preview
 * and a one-click jump.
 */
export interface DraftElsewhere {
  submission_id: string;
  kind: SubmissionKind;
  assignment: string;
  filename: string;
  word_count: number | null;
  excerpt: string;
  last_modified_at: string;
}

export interface StudentResponse {
  student: string;
  /** Empty when excerpt_status === "not_submitted" (roster placeholder). */
  submission_id: string;
  filename: string;
  kind: SubmissionKind;
  assignment: string;
  extension: string;
  size_bytes: number;
  first_seen_at: string;
  last_modified_at: string;
  word_count: number | null;
  excerpt: string;
  excerpt_status: ExcerptStatus;
  status: "new" | "seen";
  /** Set when the current row is empty AND the student has a non-empty
   *  submission in the opposite kind. Null otherwise. Always null when the
   *  view is filtered to "both kinds" (no opposite to point at). */
  draft_elsewhere: DraftElsewhere | null;
}

export async function fetchAssignmentResponses(
  cls: string,
  assignment: string,
  kind?: SubmissionKind
): Promise<StudentResponse[]> {
  const q = new URLSearchParams();
  if (kind) q.set("kind", kind);
  const url =
    `${API}/assignments/${encodeURIComponent(cls)}` +
    `/${encodeURIComponent(assignment)}/responses?${q}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load responses");
  return res.json();
}

export interface Heading {
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

export async function fetchStructure(submissionId: string): Promise<Heading[]> {
  const res = await fetch(`${API}/submissions/${submissionId}/structure`);
  if (!res.ok) throw new Error("Failed to load structure");
  const data = (await res.json()) as { headings: Heading[] };
  return data.headings;
}

export interface SubmissionChangedEvent {
  type: "submission-changed";
  id: string;
  kind: SubmissionKind;
  student: string;
  assignment: string;
  filename: string;
  watch_root_label: string;
  last_modified_at: string;
}

/**
 * Emitted when a watched file disappears from disk. Mirrors the server
 * variant in `server/src/events.ts`. Clients reconcile by `id` —
 * `student` / `assignment` / `watch_root_label` are carried so callers
 * can cheaply filter without an id lookup first.
 */
export interface SubmissionDeletedEvent {
  type: "submission-deleted";
  id: string;
  student: string;
  assignment: string;
  watch_root_label: string;
}

export type AppEvent = SubmissionChangedEvent | SubmissionDeletedEvent;

/**
 * Subscribe to live file-change events from the watcher. Returns a cleanup function.
 * Auto-reconnects on disconnect.
 */
export function subscribeToEvents(
  onEvent: (event: AppEvent) => void
): () => void {
  let closed = false;
  let source: EventSource | null = null;

  const connect = () => {
    if (closed) return;
    source = new EventSource(`${API}/events`);
    source.onmessage = (e) => {
      if (!e.data) return;
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        // ignore malformed
      }
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (!closed) setTimeout(connect, 2000);
    };
  };

  connect();

  return () => {
    closed = true;
    source?.close();
  };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
