import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { getDocStats, invalidateDocStats } from "./metrics.js";

/**
 * `getDocStats` is a cached helper. We can verify cache hits / misses
 * observably with reference-equality (`toBe`) — `computeStats` always
 * builds a fresh result object, so a returned object whose identity
 * matches a previous call MUST have come from the cache.
 *
 * Heavy docx parsing is exercised by manual verification in the dev UI;
 * here we focus on the bits that are pure and break silently:
 *   - extension gating (we don't try to extract from PDFs/images;
 *     .docx AND .pptx both go through extraction now)
 *   - missing-file handling (no exception, structured status)
 *   - cache hit on identical args
 *   - cache invalidation when mtime changes
 *   - explicit invalidateDocStats clears the entry
 *   - .pptx success path end-to-end (jszip → text → word_count + excerpt)
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

  it("returns 'missing' for a .pptx whose absolute_path no longer exists", async () => {
    const stats = await getDocStats(
      "missing-pptx-test",
      MISSING_PATH.replace(".docx", ".pptx"),
      ".pptx",
      "2026-05-26T00:00:00.000Z"
    );
    expect(stats).toEqual({
      word_count: null,
      excerpt: "",
      excerpt_status: "missing",
    });
  });
});

describe("getDocStats — .pptx end-to-end", () => {
  /**
   * Build a real .pptx on disk, run the cached helper through its full
   * pipeline (existsSync → readFileSync → jszip → extract → word_count +
   * excerpt) and prove the pptx branch returns `excerpt_status: "ok"`
   * with the right word count. Mirrors the docx coverage we get from
   * the dev UI manually — we can't unit-test docx parsing without a
   * committed binary fixture, but for pptx the in-memory zip pattern
   * lets us go end-to-end here.
   */
  it("extracts word_count + excerpt from a real .pptx written to disk", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `panopticon-pptx-${Date.now()}-${Math.random().toString(36).slice(2)}.pptx`
    );
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0"?><p:sld xmlns:p="x" xmlns:a="y"><p:cSld><p:spTree>
        <p:sp><p:txBody><a:p><a:r><a:t>hello world from a pptx</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld></p:sld>`
    );
    await fs.writeFile(
      tmp,
      Buffer.from(await zip.generateAsync({ type: "nodebuffer" }))
    );
    try {
      const stat = await fs.stat(tmp);
      const stats = await getDocStats(
        "pptx-real-test",
        tmp,
        ".pptx",
        stat.mtime.toISOString()
      );
      expect(stats.excerpt_status).toBe("ok");
      expect(stats.word_count).toBe(5);
      expect(stats.excerpt).toBe("hello world from a pptx");
    } finally {
      await fs.unlink(tmp).catch(() => {});
      invalidateDocStats("pptx-real-test");
    }
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
