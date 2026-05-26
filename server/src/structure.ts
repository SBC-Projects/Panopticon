import fs from "node:fs";
import mammoth from "mammoth";

export interface Heading {
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

interface CacheEntry {
  mtimeIso: string;
  headings: Heading[];
}

const cache = new Map<string, CacheEntry>();

/**
 * Extract h1–h3 headings from a docx. Cached per (submissionId, mtime).
 * Heading ids are deterministic slugs so the same `data-heading-id` can be
 * injected into preview HTML for scrollToHeading sync.
 */
export async function getStructure(
  submissionId: string,
  absolutePath: string,
  extension: string,
  mtimeIso: string
): Promise<Heading[]> {
  const cached = cache.get(submissionId);
  if (cached && cached.mtimeIso === mtimeIso) return cached.headings;

  const headings = await computeStructure(absolutePath, extension);
  cache.set(submissionId, { mtimeIso, headings });
  return headings;
}

async function computeStructure(
  absolutePath: string,
  extension: string
): Promise<Heading[]> {
  if (extension !== ".docx") return [];
  if (!fs.existsSync(absolutePath)) return [];

  try {
    const buffer = fs.readFileSync(absolutePath);
    const result = await mammoth.convertToHtml({ buffer });
    return parseHeadings(result.value || "");
  } catch {
    return [];
  }
}

const HEADING_RE = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;

export function parseHeadings(html: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let match: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((match = HEADING_RE.exec(html)) !== null) {
    const level = Number(match[1]) as 1 | 2 | 3;
    const text = stripTags(match[2]).trim();
    if (!text) continue;
    const id = uniqueSlug(text, seen);
    out.push({ id, level, text });
  }
  return out;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ");
}

function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

/** Drop a single entry (e.g. when a file is deleted). Mirrors `invalidateDocStats`. */
export function invalidateStructure(submissionId: string): void {
  cache.delete(submissionId);
}

/**
 * Augment mammoth's HTML output so heading tags carry a deterministic
 * `data-heading-id` matching the structure endpoint. Used by DocPreview to
 * scroll to a given heading.
 */
export function injectHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(
    /<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_full, level, attrs, inner) => {
      const text = stripTags(inner).trim();
      if (!text) return _full;
      const id = uniqueSlug(text, seen);
      const cleanedAttrs = (attrs as string).replace(
        /\s*data-heading-id\s*=\s*"[^"]*"/i,
        ""
      );
      return `<h${level}${cleanedAttrs} data-heading-id="${id}">${inner}</h${level}>`;
    }
  );
}
