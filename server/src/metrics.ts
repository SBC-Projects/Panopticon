import fs from "node:fs";
import mammoth from "mammoth";

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
}

interface CacheEntry {
  mtimeIso: string;
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
  const cached = cache.get(submissionId);
  if (cached && cached.mtimeIso === mtimeIso) return cached.stats;

  const stats = await computeStats(absolutePath, extension);
  cache.set(submissionId, { mtimeIso, stats });
  return stats;
}

async function computeStats(
  absolutePath: string,
  extension: string
): Promise<DocStats> {
  if (extension !== ".docx") {
    return { word_count: null, excerpt: "" };
  }
  if (!fs.existsSync(absolutePath)) {
    return { word_count: null, excerpt: "" };
  }

  try {
    const buffer = fs.readFileSync(absolutePath);
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || "").trim();
    const word_count = text ? text.split(/\s+/).length : 0;
    const excerpt = truncate(text, EXCERPT_LENGTH);
    return { word_count, excerpt };
  } catch {
    return { word_count: null, excerpt: "" };
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/** Drop a single entry (e.g. when a file is deleted). */
export function invalidateDocStats(submissionId: string): void {
  cache.delete(submissionId);
}
