import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveWatchRoot } from "./watcher.js";
import type { WatchRoot } from "./types.js";

/**
 * `resolveWatchRoot` answers "which configured watch root, if any, owns this
 * file path?". It's pure and ships from the watcher because both `add/change`
 * (processFile) and `unlink` (processDelete) need it. The interesting cases
 * are the boundary ones — sibling-prefix paths, exact matches, paths outside
 * any root — because getting them wrong silently misroutes events.
 */

const ROOT_A = path.join("C:", "watch", "ClassA - Student Work", "Submitted files");
const ROOT_B = path.join("C:", "watch", "ClassB - Student Work", "Working files");
const ROOT_A_SIBLING_PREFIX = path.join(
  "C:",
  "watch",
  "ClassA - Student Work",
  "Submitted files (copy)"
);

const roots: WatchRoot[] = [
  { path: ROOT_A, label: "ClassA", kind: "submitted" },
  { path: ROOT_B, label: "ClassB", kind: "working" },
];

describe("resolveWatchRoot", () => {
  it("matches a file nested inside a watch root", () => {
    const file = path.join(ROOT_A, "Emma Wilson", "Week 3", "essay.docx");
    expect(resolveWatchRoot(roots, file)).toBe(roots[0]);
  });

  it("matches the watch-root path itself (no trailing separator)", () => {
    expect(resolveWatchRoot(roots, ROOT_A)).toBe(roots[0]);
  });

  it("picks the correct root when multiple are configured", () => {
    const fileInB = path.join(ROOT_B, "Liam", "General", "draft.docx");
    expect(resolveWatchRoot(roots, fileInB)).toBe(roots[1]);
  });

  it("returns undefined for a path outside every configured root", () => {
    const outside = path.join("C:", "elsewhere", "essay.docx");
    expect(resolveWatchRoot(roots, outside)).toBeUndefined();
  });

  it("does NOT match a sibling path whose prefix matches a root (no path.sep boundary)", () => {
    const file = path.join(ROOT_A_SIBLING_PREFIX, "Emma Wilson", "essay.docx");
    expect(resolveWatchRoot(roots, file)).toBeUndefined();
  });

  it("returns undefined when there are no roots configured", () => {
    expect(
      resolveWatchRoot([], path.join("C:", "any", "file.docx"))
    ).toBeUndefined();
  });
});
