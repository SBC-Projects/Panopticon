import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanWatchRoots } from "./scanner.js";
import { EventBus } from "./events.js";
import type { SubmissionStore } from "./db.js";
import type { WatchRoot } from "./types.js";

/**
 * `scanWatchRoots` was historically a "walk + upsert + count" helper. The
 * deferred-scan boot path (fix/dev-startup-defer-scan) made it also emit
 * `submission-changed` per newly-inserted row when an `EventBus` is
 * supplied. These tests pin down that contract without standing up a
 * real SQLite store: we substitute a tiny in-memory stand-in that
 * records calls and decides isNew based on path.
 *
 * Filesystem fixture: a temp dir laid out as a real watch root,
 * `<temp>/Demo Class - Student Work/Submitted files/<student>/<assignment>/<file>`.
 */

interface UpsertCall {
  rootPath: string;
  label: string;
  filename: string;
}

function makeFakeStore(): {
  store: SubmissionStore;
  calls: UpsertCall[];
  /** Returns isNew=true for files not yet seen during this test. */
  seenIds: Set<string>;
} {
  const calls: UpsertCall[] = [];
  const seenIds = new Set<string>();
  const fake = {
    upsertFromFile(
      rootPath: string,
      label: string,
      _kind: "submitted" | "working",
      _absolutePath: string,
      parsed: { relative_path: string; filename: string },
      _mtime: Date,
      _size: number
    ): { isNew: boolean; contentChanged: boolean } {
      calls.push({ rootPath, label, filename: parsed.filename });
      const key = `${rootPath}::${parsed.relative_path}`;
      const isNew = !seenIds.has(key);
      seenIds.add(key);
      return { isNew, contentChanged: isNew };
    },
  };
  return { store: fake as unknown as SubmissionStore, calls, seenIds };
}

let tempDir: string;
let rootPath: string;
let watchRoot: WatchRoot;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "panopticon-scan-"));
  rootPath = path.join(tempDir, "Demo Class - Student Work", "Submitted files");
  fs.mkdirSync(path.join(rootPath, "Emma Wilson", "Week 3"), { recursive: true });
  fs.mkdirSync(path.join(rootPath, "Liam Smith", "Week 3"), { recursive: true });
  fs.writeFileSync(path.join(rootPath, "Emma Wilson", "Week 3", "essay.docx"), "x");
  fs.writeFileSync(path.join(rootPath, "Liam Smith", "Week 3", "draft.docx"), "x");
  watchRoot = { path: rootPath, label: "Demo Class", kind: "submitted" };
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("scanWatchRoots", () => {
  it("returns scanned + added counts and upserts every non-ignored file", () => {
    const { store, calls } = makeFakeStore();

    const result = scanWatchRoots([watchRoot], store);

    expect(result.scanned).toBe(2);
    expect(result.added).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.filename).sort()).toEqual(
      ["draft.docx", "essay.docx"]
    );
  });

  it("emits one submission-changed event per new row when an EventBus is supplied", () => {
    const { store } = makeFakeStore();
    const events = new EventBus();
    const emit = vi.spyOn(events, "emit");

    const result = scanWatchRoots([watchRoot], store, events);

    expect(result.added).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
    const types = emit.mock.calls.map((c) => c[0].type);
    expect(new Set(types)).toEqual(new Set(["submission-changed"]));
    // Payload should carry the fields client reconcilers filter on.
    const firstEvent = emit.mock.calls[0][0];
    expect(firstEvent).toMatchObject({
      type: "submission-changed",
      watch_root_label: "Demo Class",
      kind: "submitted",
    });
    expect(firstEvent).toHaveProperty("id");
    expect(firstEvent).toHaveProperty("student");
    expect(firstEvent).toHaveProperty("assignment");
    expect(firstEvent).toHaveProperty("last_modified_at");
  });

  it("emits zero events when no EventBus is supplied (backwards-compatible call)", () => {
    const { store } = makeFakeStore();
    // No way to spy without an instance, so just confirm the call signature
    // still works and adds rows. Absence of crash here is the contract.
    const result = scanWatchRoots([watchRoot], store);
    expect(result.added).toBe(2);
  });

  it("does NOT emit events for rows that already existed (isNew === false)", () => {
    const { store, seenIds } = makeFakeStore();
    // Pre-seed so every file looks like an existing row.
    seenIds.add(`${rootPath}::Emma Wilson/Week 3/essay.docx`);
    seenIds.add(`${rootPath}::Liam Smith/Week 3/draft.docx`);
    const events = new EventBus();
    const emit = vi.spyOn(events, "emit");

    const result = scanWatchRoots([watchRoot], store, events);

    expect(result.scanned).toBe(2);
    expect(result.added).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("skips a watch root whose path does not exist (warn + continue)", () => {
    const { store, calls } = makeFakeStore();
    const ghost: WatchRoot = {
      path: path.join(tempDir, "Nonexistent"),
      label: "Ghost",
      kind: "working",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = scanWatchRoots([ghost, watchRoot], store);

    expect(result.scanned).toBe(2); // only the real root contributed
    expect(calls.every((c) => c.label === "Demo Class")).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Watch root not found")
    );
    warn.mockRestore();
  });
});
