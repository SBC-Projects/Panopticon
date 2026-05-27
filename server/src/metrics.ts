import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { extractPptxText } from "./pptx.js";

/**
 * Why an excerpt might be missing. Lets the UI explain the failure
 * instead of just showing a blank card.
 *
 *  - `ok`              — text was extracted successfully
 *  - `empty_body`      — docx parsed cleanly but contained no text runs
 *                        (often a SharePoint live-coauthor doc whose latest
 *                         text hasn't been written back to local disk yet)
 *  - `not_downloaded`  — file is 0 bytes on disk; OneDrive Files-On-Demand
 *                        hasn't streamed the content down yet
 *  - `missing`         — the absolute path is gone (file deleted/moved)
 *  - `unsupported_ext` — not a docx, so we don't attempt text extraction
 *  - `parse_error`     — mammoth threw; details logged server-side
 *  - `not_submitted`   — synthetic status for a roster row: this student
 *                        is enrolled in the class but has no file at all
 *                        for this (assignment, kind) tuple
 */
export type ExcerptStatus =
  | "ok"
  | "empty_body"
  | "not_downloaded"
  | "missing"
  | "unsupported_ext"
  | "parse_error"
  | "not_submitted";

/**
 * Cached doc-derived stats for a single submission file.
 *
 * Cache key = submission id; entry is invalidated when mtime changes.
 * `word_count` is null when the file isn't a docx (we don't try to count text
 * inside binaries like PDFs — those go through a different path).
 */
export interface DocStats {
  word_count: number | null;
  excerpt: string;
  excerpt_status: ExcerptStatus;
}

interface CacheEntry {
  mtimeIso: string;
  size: number;
  stats: DocStats;
}

const EXCERPT_LENGTH = 220;
const cache = new Map<string, CacheEntry>();

export async function getDocStats(
  submissionId: string,
  absolutePath: string,
  extension: string,
  mtimeIso: string
): Promise<DocStats> {
  // Include file size in the cache key so OneDrive "0 bytes → real bytes"
  // transitions invalidate the entry even when mtime is unchanged.
  let size = 0;
  try {
    size = fs.statSync(absolutePath).size;
  } catch {
    // fall through; computeStats will report `missing`
  }

  const cached = cache.get(submissionId);
  if (cached && cached.mtimeIso === mtimeIso && cached.size === size) {
    return cached.stats;
  }

  const stats = await computeStats(absolutePath, extension);
  cache.set(submissionId, { mtimeIso, size, stats });
  return stats;
}

async function computeStats(
  absolutePath: string,
  extension: string
): Promise<DocStats> {
  if (extension !== ".docx" && extension !== ".pptx") {
    return { word_count: null, excerpt: "", excerpt_status: "unsupported_ext" };
  }
  if (!fs.existsSync(absolutePath)) {
    return { word_count: null, excerpt: "", excerpt_status: "missing" };
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch (err) {
    logParseFailure("read", absolutePath, err);
    return { word_count: null, excerpt: "", excerpt_status: "parse_error" };
  }

  if (buffer.length === 0) {
    return { word_count: 0, excerpt: "", excerpt_status: "not_downloaded" };
  }

  return extension === ".docx"
    ? computeDocxStats(absolutePath, buffer)
    : computePptxStats(absolutePath, buffer);
}

async function computeDocxStats(
  absolutePath: string,
  buffer: Buffer
): Promise<DocStats> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return statsFromText(result.value || "");
  } catch (err) {
    logParseFailure("mammoth", absolutePath, err);
    return { word_count: null, excerpt: "", excerpt_status: "parse_error" };
  }
}

async function computePptxStats(
  absolutePath: string,
  buffer: Buffer
): Promise<DocStats> {
  try {
    const result = await extractPptxText(buffer);
    return statsFromText(result.text);
  } catch (err) {
    logParseFailure("jszip", absolutePath, err);
    return { word_count: null, excerpt: "", excerpt_status: "parse_error" };
  }
}

function statsFromText(raw: string): DocStats {
  const text = raw.trim();
  if (!text) {
    return { word_count: 0, excerpt: "", excerpt_status: "empty_body" };
  }
  const word_count = text.split(/\s+/).length;
  const excerpt = truncate(text, EXCERPT_LENGTH);
  return { word_count, excerpt, excerpt_status: "ok" };
}

function logParseFailure(stage: string, absolutePath: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(
    `[metrics] ${stage} failed for ${path.basename(absolutePath)}: ${msg}`
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/** Drop a single entry (e.g. when a file is deleted). */
export function invalidateDocStats(submissionId: string): void {
  cache.delete(submissionId);
}
