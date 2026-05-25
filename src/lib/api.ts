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

export type PreviewResponse =
  | { type: "html"; html: string; last_modified_at: string }
  | { type: "binary"; mime: string; last_modified_at: string }
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

export interface StudentResponse {
  student: string;
  submission_id: string;
  filename: string;
  kind: SubmissionKind;
  extension: string;
  size_bytes: number;
  first_seen_at: string;
  last_modified_at: string;
  word_count: number | null;
  excerpt: string;
  status: "new" | "seen";
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

export type AppEvent = SubmissionChangedEvent;

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
