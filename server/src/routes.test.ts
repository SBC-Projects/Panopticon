import { describe, it, expect } from "vitest";
import { pickLatestPerStudent } from "./routes.js";
import type { Submission, SubmissionKind } from "./types.js";

/**
 * `pickLatestPerStudent` is the per-student rollup that powers the
 * `/api/assignments/:label/:assignment/responses` endpoint. It collapses
 * potentially multiple `Submission` rows for one student down to a single
 * row, preferring the latest `.docx` and falling back to the latest file of
 * any extension. The endpoint and the Live Monitor UI assume:
 *
 *   - Exactly one row per student in the output.
 *   - `.docx` beats any other extension, even when the other extension is
 *     newer (teachers care about the Word doc; PDF exports are noise).
 *   - The function respects input order — `SubmissionStore.list` returns
 *     rows ordered by `last_modified_at DESC`, so the FIRST row seen for a
 *     given (student, extension) IS the latest.
 *
 * These tests lock down that contract so a refactor of the rollup can't
 * silently flip the extension-preference rule or the "respects input order"
 * invariant.
 */

let idCounter = 0;

function makeSubmission(overrides: Partial<Submission> = {}): Submission {
  idCounter += 1;
  const filename = overrides.filename ?? `file-${idCounter}.docx`;
  const extension =
    overrides.extension ?? filename.slice(filename.lastIndexOf("."));
  const student = overrides.student ?? "Emma Wilson";
  const assignment = overrides.assignment ?? "Week 3";
  return {
    id: overrides.id ?? `id-${idCounter}`,
    watch_root_label: overrides.watch_root_label ?? "Class A",
    kind: (overrides.kind ?? "submitted") as SubmissionKind,
    student,
    assignment,
    filename,
    relative_path:
      overrides.relative_path ?? `${student}/${assignment}/${filename}`,
    absolute_path:
      overrides.absolute_path ??
      `C:/watch/${student}/${assignment}/${filename}`,
    extension,
    size_bytes: overrides.size_bytes ?? 1024,
    first_seen_at: overrides.first_seen_at ?? "2026-05-01T00:00:00.000Z",
    last_modified_at:
      overrides.last_modified_at ?? "2026-05-26T00:00:00.000Z",
    status: overrides.status ?? "seen",
  };
}

describe("pickLatestPerStudent — single student", () => {
  it("returns the only row when a student has exactly one .docx", () => {
    const row = makeSubmission({
      student: "Emma Wilson",
      filename: "essay.docx",
    });
    expect(pickLatestPerStudent([row])).toEqual([row]);
  });

  it("picks the first .docx in input order when multiple .docx exist (input is DESC by mtime)", () => {
    const newer = makeSubmission({
      id: "newer",
      student: "Emma Wilson",
      filename: "essay-v2.docx",
      last_modified_at: "2026-05-26T12:00:00.000Z",
    });
    const older = makeSubmission({
      id: "older",
      student: "Emma Wilson",
      filename: "essay-v1.docx",
      last_modified_at: "2026-05-26T09:00:00.000Z",
    });
    expect(pickLatestPerStudent([newer, older])).toEqual([newer]);
  });

  it("respects input order even when the caller hands rows in non-DESC order", () => {
    // This test exists to make the "first-seen-wins" contract explicit:
    // the helper trusts caller-supplied ordering rather than re-sorting.
    const first = makeSubmission({
      id: "first-in-input",
      student: "Emma Wilson",
      filename: "essay-older.docx",
      last_modified_at: "2026-05-26T09:00:00.000Z",
    });
    const second = makeSubmission({
      id: "second-in-input",
      student: "Emma Wilson",
      filename: "essay-newer.docx",
      last_modified_at: "2026-05-26T12:00:00.000Z",
    });
    expect(pickLatestPerStudent([first, second])).toEqual([first]);
  });

  it("prefers .docx over a newer .pdf for the same student", () => {
    const newerPdf = makeSubmission({
      id: "pdf",
      student: "Emma Wilson",
      filename: "essay.pdf",
      extension: ".pdf",
      last_modified_at: "2026-05-26T15:00:00.000Z",
    });
    const olderDocx = makeSubmission({
      id: "docx",
      student: "Emma Wilson",
      filename: "essay.docx",
      last_modified_at: "2026-05-26T09:00:00.000Z",
    });
    // Caller-supplied order is DESC by mtime, so the .pdf comes first.
    expect(pickLatestPerStudent([newerPdf, olderDocx])).toEqual([olderDocx]);
  });

  it("falls back to the latest non-.docx when the student has no .docx", () => {
    const newerPdf = makeSubmission({
      id: "newer-pdf",
      student: "Emma Wilson",
      filename: "essay-v2.pdf",
      extension: ".pdf",
      last_modified_at: "2026-05-26T15:00:00.000Z",
    });
    const olderPdf = makeSubmission({
      id: "older-pdf",
      student: "Emma Wilson",
      filename: "essay-v1.pdf",
      extension: ".pdf",
      last_modified_at: "2026-05-26T09:00:00.000Z",
    });
    expect(pickLatestPerStudent([newerPdf, olderPdf])).toEqual([newerPdf]);
  });
});

describe("pickLatestPerStudent — multiple students", () => {
  it("returns exactly one row per student", () => {
    const emmaDocx = makeSubmission({
      id: "emma-docx",
      student: "Emma Wilson",
      filename: "essay.docx",
      last_modified_at: "2026-05-26T12:00:00.000Z",
    });
    const emmaPdf = makeSubmission({
      id: "emma-pdf",
      student: "Emma Wilson",
      filename: "essay.pdf",
      extension: ".pdf",
      last_modified_at: "2026-05-26T15:00:00.000Z",
    });
    const liamDocxNewer = makeSubmission({
      id: "liam-newer",
      student: "Liam Brown",
      filename: "essay-v2.docx",
      last_modified_at: "2026-05-26T14:00:00.000Z",
    });
    const liamDocxOlder = makeSubmission({
      id: "liam-older",
      student: "Liam Brown",
      filename: "essay-v1.docx",
      last_modified_at: "2026-05-26T10:00:00.000Z",
    });
    const avaPdf = makeSubmission({
      id: "ava-pdf",
      student: "Ava Lee",
      filename: "essay.pdf",
      extension: ".pdf",
      last_modified_at: "2026-05-26T11:00:00.000Z",
    });

    const input = [
      emmaPdf,
      liamDocxNewer,
      emmaDocx,
      avaPdf,
      liamDocxOlder,
    ];
    const out = pickLatestPerStudent(input);

    expect(out).toHaveLength(3);

    const byStudent = new Map(out.map((r) => [r.student, r]));
    expect(byStudent.get("Emma Wilson")).toBe(emmaDocx);
    expect(byStudent.get("Liam Brown")).toBe(liamDocxNewer);
    expect(byStudent.get("Ava Lee")).toBe(avaPdf);
  });
});

describe("pickLatestPerStudent — empty input", () => {
  it("returns an empty array for an empty input", () => {
    expect(pickLatestPerStudent([])).toEqual([]);
  });
});
