import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  parseSubmissionPath,
  shouldIgnoreFile,
  submissionId,
} from "./parser.js";

/**
 * `parser` shapes the (student, assignment, filename) tuple from a filesystem
 * path. It's pure, so cheap to test exhaustively. Pay particular attention to:
 *   - cross-platform path separators (\\ on Windows, / elsewhere)
 *   - the "file directly under student" fallback to assignment="General"
 *   - the ignore filter (~$lock files, OneDrive sidecars, Thumbs.db, etc.)
 */

const ROOT = path.join("C:", "watch");
const join = (...parts: string[]) => path.join(ROOT, ...parts);

describe("parseSubmissionPath", () => {
  it("extracts student / assignment / filename for nested paths", () => {
    const parsed = parseSubmissionPath(
      ROOT,
      join("Emma Wilson", "Week 3", "essay.docx")
    );
    expect(parsed).toEqual({
      student: "Emma Wilson",
      assignment: "Week 3",
      filename: "essay.docx",
      relative_path: "Emma Wilson/Week 3/essay.docx",
    });
  });

  it("joins multi-level assignment segments with ' / '", () => {
    const parsed = parseSubmissionPath(
      ROOT,
      join("Emma Wilson", "Week 3", "Drafts", "v2.docx")
    );
    expect(parsed?.assignment).toBe("Week 3 / Drafts");
  });

  it("falls back to 'General' when a file sits directly under the student folder", () => {
    const parsed = parseSubmissionPath(
      ROOT,
      join("Emma Wilson", "loose-file.docx")
    );
    expect(parsed?.assignment).toBe("General");
  });

  it("returns null for paths outside the watch root", () => {
    expect(
      parseSubmissionPath(ROOT, path.join("C:", "elsewhere", "f.docx"))
    ).toBeNull();
  });

  it("returns null for ignored filenames (OneDrive lock files)", () => {
    expect(
      parseSubmissionPath(ROOT, join("Emma Wilson", "Week 3", "~$essay.docx"))
    ).toBeNull();
  });

  it("emits posix-style relative_path even on Windows-style inputs", () => {
    const parsed = parseSubmissionPath(
      ROOT,
      join("Emma Wilson", "Week 3", "essay.docx")
    );
    expect(parsed?.relative_path).not.toContain("\\");
    expect(parsed?.relative_path).toBe("Emma Wilson/Week 3/essay.docx");
  });
});

describe("shouldIgnoreFile", () => {
  it.each([
    ["~$open.docx", true, "Word lock file"],
    ["thumbs.db", true, "Windows thumbs"],
    ["Thumbs.db", true, "case-insensitive thumbs"],
    ["desktop.ini", true, "Windows folder metadata"],
    [".odlock", true, "OneDrive sidecar"],
    ["something.tmp", true, "tmp"],
    ["essay.docx", false, "real document"],
    ["Photo.PNG", false, "uppercase image"],
  ])("'%s' → %s (%s)", (name, expected) => {
    expect(shouldIgnoreFile(name)).toBe(expected);
  });
});

describe("submissionId", () => {
  it("is deterministic for the same inputs", () => {
    const a = submissionId(ROOT, "Emma/Week 3/essay.docx");
    const b = submissionId(ROOT, "Emma/Week 3/essay.docx");
    expect(a).toBe(b);
  });

  it("differs when watch root or relative path differs", () => {
    const base = submissionId(ROOT, "Emma/Week 3/essay.docx");
    expect(submissionId(ROOT + "X", "Emma/Week 3/essay.docx")).not.toBe(base);
    expect(submissionId(ROOT, "Emma/Week 3/essay2.docx")).not.toBe(base);
  });

  it("returns a 32-char hex string", () => {
    const id = submissionId(ROOT, "Emma/Week 3/essay.docx");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
