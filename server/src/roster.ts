import fs from "node:fs";
import type { SubmissionStore } from "./db.js";
import type { AppConfig, Submission, SubmissionKind, WatchRoot } from "./types.js";

/**
 * The full set of students for a class is the union of immediate
 * subfolder names across every watch root that shares the class label —
 * a student is "enrolled" if they have a folder anywhere in the class,
 * even before they've created their first submission.
 *
 * We optionally filter by `kind` so the caller can ask for "only students
 * who have at least a folder under the Working files root" etc.
 */
export function getClassRoster(
  config: AppConfig,
  classLabel: string,
  kind?: SubmissionKind
): string[] {
  const roots = config.watch_roots.filter(
    (r) => r.label === classLabel && (!kind || r.kind === kind)
  );
  const names = new Set<string>();
  for (const root of roots) {
    for (const name of listStudentFolders(root)) {
      names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function listStudentFolders(root: WatchRoot): string[] {
  if (!fs.existsSync(root.path)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root.path, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

/**
 * For a given (class, student, currently-viewed kind, currently-viewed
 * assignment), find the student's "best match" submission from the
 * OPPOSITE kind — typically used to point teachers at a live Working
 * draft when the Submitted file they're staring at is empty.
 *
 * Heuristic for "best match" (in order):
 *  1. Same root assignment family. We take the first " / "-separated
 *     segment of `currentAssignment` (so "26-05-26 - Evaluations / Version 1"
 *     reduces to "26-05-26 - Evaluations") and look for opposite-kind
 *     submissions whose assignment equals or starts with that family.
 *  2. If no family match, fall back to the student's most-recently-
 *     modified submission of any assignment in the opposite kind.
 *  3. Returns null if the student has no opposite-kind submissions at all.
 *
 * Returns the full Submission row so the caller can compute stats and
 * build a pointer the client can use to jump straight to it.
 */
export function findDraftElsewhere(
  store: SubmissionStore,
  classLabel: string,
  student: string,
  currentKind: SubmissionKind,
  currentAssignment: string
): Submission | null {
  const otherKind: SubmissionKind =
    currentKind === "submitted" ? "working" : "submitted";

  // store.list returns rows ordered by last_modified_at DESC and uses LIKE
  // on the student filter, so post-filter for exact match.
  const all = store
    .list({
      watch_root_label: classLabel,
      student,
      kind: otherKind,
    })
    .filter((r) => r.student === student);
  if (all.length === 0) return null;

  const family = currentAssignment.split(" / ")[0].trim();
  const familyMatches = family
    ? all.filter(
        (r) =>
          r.assignment === family || r.assignment.startsWith(family + " / ")
      )
    : [];

  const candidates = familyMatches.length > 0 ? familyMatches : all;
  return candidates[0] ?? null;
}
