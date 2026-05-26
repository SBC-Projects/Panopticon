import { describe, it, expect, beforeEach } from "vitest";
import { getDocStats, invalidateDocStats } from "./metrics.js";

/**
 * `getDocStats` is a cached helper. We can verify cache hits / misses
 * observably with reference-equality (`toBe`) — `computeStats` always
 * builds a fresh result object, so a returned object whose identity
 * matches a previous call MUST have come from the cache.
 *
 * Heavy docx parsing is exercised by manual verification in the dev UI;
 * here we focus on the bits that are pure and break silently:
 *   - extension gating (we don't try to extract from PDFs/images)
 *   - missing-file handling (no exception, structured status)
 *   - cache hit on identical args
 *   - cache invalidation when mtime changes
 *   - explicit invalidateDocStats clears the entry
 */

const MISSING_PATH = "/__panopticon_test_does_not_exist__/file.docx";

describe("getDocStats — extension gating", () => {
  it("returns 'unsupported_ext' for non-docx files (no I/O attempted)", async () => {
    const stats = await getDocStats(
      "ext-test-pdf",
      "/anywhere.pdf",
      ".pdf",
      "2026-05-26T00:00:00.000Z"
    );
    expect(stats).toEqual({
      word_count: null,
      excerpt: "",
      excerpt_status: "unsupported_ext",
    });
  });

  it("returns 'unsupported_ext' for empty extension", async () => {
    const stats = await getDocStats(
      "ext-test-blank",
      "/noext",
      "",
      "2026-05-26T00:00:00.000Z"
    );
    expect(stats.excerpt_status).toBe("unsupported_ext");
  });
});

describe("getDocStats — missing files", () => {
  it("returns 'missing' for a .docx whose absolute_path no longer exists", async () => {
    const stats = await getDocStats(
      "missing-test",
      MISSING_PATH,
      ".docx",
      "2026-05-26T00:00:00.000Z"
    );
    expect(stats).toEqual({
      word_count: null,
      excerpt: "",
      excerpt_status: "missing",
    });
  });
});

describe("getDocStats — caching", () => {
  beforeEach(() => {
    invalidateDocStats("cache-test");
  });

  it("returns the same object reference on a cache hit", async () => {
    const a = await getDocStats(
      "cache-test",
      MISSING_PATH,
      ".docx",
      "2026-05-26T00:00:00.000Z"
    );
    const b = await getDocStats(
      "cache-test",
      MISSING_PATH,
      ".docx",
      "2026-05-26T00:00:00.000Z"
    );
    expect(b).toBe(a);
  });

  it("recomputes when mtime changes (different reference returned)", async () => {
    const a = await getDocStats(
      "cache-test",
      MISSING_PATH,
      ".docx",
      "2026-05-26T00:00:00.000Z"
    );
    const b = await getDocStats(
      "cache-test",
      MISSING_PATH,
      ".docx",
      "2026-05-27T00:00:00.000Z"
    );
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
  });

  it("invalidateDocStats forces the next call to recompute", async () => {
    const a = await getDocStats(
      "cache-test",
      MISSING_PATH,
      ".docx",
      "2026-05-26T00:00:00.000Z"
    );
    invalidateDocStats("cache-test");
    const b = await getDocStats(
      "cache-test",
      MISSING_PATH,
      ".docx",
      "2026-05-26T00:00:00.000Z"
    );
    expect(b).not.toBe(a);
  });
});
