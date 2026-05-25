import path from "node:path";
import crypto from "node:crypto";
import type { ParsedPath } from "./types.js";

const IGNORED_NAMES = new Set([
  "desktop.ini",
  ".ds_store",
  "thumbs.db",
]);

export function shouldIgnoreFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (IGNORED_NAMES.has(lower)) return true;
  if (filename.startsWith("~$")) return true;
  if (lower.endsWith(".tmp")) return true;
  if (lower.startsWith(".od")) return true;
  return false;
}

export function parseSubmissionPath(
  watchRoot: string,
  absolutePath: string
): ParsedPath | null {
  const rel = path.relative(watchRoot, absolutePath);
  if (!rel || rel.startsWith("..")) return null;

  const normalized = rel.split(path.sep).join("/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const filename = parts[parts.length - 1];
  if (shouldIgnoreFile(filename)) return null;

  const student = parts[0];
  let assignment: string;

  if (parts.length === 2) {
    assignment = "General";
  } else {
    assignment = parts.slice(1, -1).join(" / ");
  }

  return {
    student,
    assignment,
    filename,
    relative_path: normalized,
  };
}

export function submissionId(
  watchRoot: string,
  relativePath: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${watchRoot}::${relativePath}`)
    .digest("hex")
    .slice(0, 32);
}
